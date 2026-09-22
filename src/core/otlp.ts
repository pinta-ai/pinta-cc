import os from "os";
import type { BaseEvent } from "./types.js";
import { getClaudeCodeVersion } from "./claude-version.js";
import { resolveModel } from "./model.js";
import { applyModelEvidence } from "./model-evidence.js";
import {
  attrsFromRecord,
  buildPayload,
  snakeCase,
  type AttrPolicy,
  type OtlpAttribute,
  type OtlpPayload,
} from "@pinta-ai/core";

// OTLP envelope + the redaction-aware attribute pipeline now live in
// @pinta-ai/core. This module keeps only the cc-specific bits: event flattening,
// resource attributes, CLI version resolution, and the redaction policy.

// os.userInfo() THROWS when the running uid has no passwd entry (containers with
// arbitrary uid, CI, service/launchd accounts). resourceAttrs() runs on every
// span build, so an unguarded call there means total telemetry loss in those
// environments. Guard + memoize: identical value in the normal case, never throws.
let cachedProcessOwner: string | undefined;
function processOwner(): string {
  if (cachedProcessOwner === undefined) {
    try {
      cachedProcessOwner = os.userInfo().username;
    } catch {
      cachedProcessOwner =
        process.env.USER ??
        process.env.LOGNAME ??
        (typeof process.getuid === "function" ? String(process.getuid()) : "unknown");
    }
  }
  return cachedProcessOwner;
}

const PLUGIN_VERSION = "1.8.0"; // keep in sync with .claude-plugin/plugin.json

/**
 * Attribute keys for which redaction (Tier 1) is skipped. Truncation (Tier 3)
 * still applies. These are identifiers, enums, or our own resource attrs that
 * are known-safe and where false-positive masking would hurt more than help.
 */
const SKIP_REDACT_KEYS: ReadonlySet<string> = new Set([
  "cc.hook",
  "cc.tool_name",
  "cc.tool_use_id",
  "cc.session_id",
  "cc.transcript_path",
  "cc.cwd",
  "cc.permission_mode",
]);

// flattenEvent emits cc.tool_input as a single JSON-stringified attribute (no
// nested flattening today), so strict equality matches actual behavior. If
// nested flattening is ever added, re-evaluate to avoid extending bash context
// to unrelated nested keys (e.g. cc.tool_input.file_path).
const BASH_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "cc.tool_input",
  "cc.tool_response",
]);

const ATTR_POLICY: AttrPolicy = {
  skipRedactKeys: SKIP_REDACT_KEYS,
  bashContextKeys: BASH_CONTEXT_KEYS,
};

function flattenEvent(event: BaseEvent, now: number): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  // Discriminator first so aware-backend's detectIngestType hits it cheaply.
  out.push({ key: "ingest.type", value: { stringValue: "cc" } });
  // Always set cc.hook explicitly so server queries have a canonical key
  // regardless of incoming field name.
  out.push({ key: "cc.hook", value: { stringValue: event.hook_event_name } });
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (k === "hook_event_name") continue; // covered by cc.hook above
    rest[k] = v;
  }
  applyModelEvidence(rest, resolveModel(event, now));
  out.push(...attrsFromRecord(rest, "cc", ATTR_POLICY));
  return out;
}

function resourceAttrs(versionCacheDir?: string): OtlpAttribute[] {
  return [
    { key: "service.name", value: { stringValue: "claude-code" } },
    { key: "service.version", value: { stringValue: getClaudeCodeVersion(versionCacheDir) } },
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-cc" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: PLUGIN_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: processOwner() } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } },
  ];
}

/**
 * The span for one hook event. Carries no `pinta.guard.*` attributes: the guard
 * is asked about this payload and its verdict is attached afterwards with
 * core's `attachGuard`, so the judged span and the sent span are one object.
 */
export function buildOtlpPayload(args: {
  event: BaseEvent;
  traceId: string; // ULID (26 chars)
  now?: number; // ms since epoch; injectable for tests
  versionCacheDir?: string;
}): OtlpPayload {
  const now = args.now ?? Date.now();
  return buildPayload({
    traceId: args.traceId,
    spanName: `cc.${snakeCase(args.event.hook_event_name)}`,
    attributes: flattenEvent(args.event, now),
    resource: resourceAttrs(args.versionCacheDir),
    scope: { name: "pinta-cc", version: PLUGIN_VERSION },
    now,
  });
}
