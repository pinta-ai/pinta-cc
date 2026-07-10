import fs from "fs";
import os from "os";
import path from "path";
import type { BaseEvent } from "./types.js";
import {
  attrsFromRecord,
  buildPayload,
  snakeCase,
  type AttrPolicy,
  type GuardResult,
  type OtlpAttribute,
  type OtlpPayload,
} from "@pinta-ai/core";

// OTLP envelope + the redaction-aware attribute pipeline now live in
// @pinta-ai/core. This module keeps only the cc-specific bits: event flattening,
// resource attributes, CLI version resolution, and the redaction policy.

const PLUGIN_VERSION = "1.5.0"; // keep in sync with .claude-plugin/plugin.json

/**
 * Resolve the Claude Code CLI version by walking up from the binary path
 * (CLAUDE_CODE_EXECPATH) until we find the `@anthropic-ai/claude-code`
 * package.json. Different install layouts (npm global, pnpm, bundled) put
 * the binary at different depths, so we can't hard-code "..".
 *
 * Cached at module scope — one read per hook process.
 * Falls back to "unknown" on any failure so a missing CLI never fails the hook.
 */
let cachedCliVersion: string | null = null;
function getClaudeCodeVersion(): string {
  if (cachedCliVersion !== null) return cachedCliVersion;
  cachedCliVersion = resolveClaudeCodeVersion() ?? "unknown";
  return cachedCliVersion;
}

const MAX_WALK_DEPTH = 6;

function resolveClaudeCodeVersion(): string | null {
  const execPath = process.env.CLAUDE_CODE_EXECPATH;
  if (!execPath) return null;
  let dir = path.dirname(execPath);
  const root = path.parse(dir).root;
  for (let i = 0; i < MAX_WALK_DEPTH && dir !== root; i++) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
      if (
        typeof parsed.name === "string" &&
        parsed.name.startsWith("@anthropic-ai/claude-code") &&
        typeof parsed.version === "string"
      ) {
        return parsed.version;
      }
    } catch {
      // keep walking
    }
    dir = path.dirname(dir);
  }
  return null;
}

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

function flattenEvent(event: BaseEvent): OtlpAttribute[] {
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
  out.push(...attrsFromRecord(rest, "cc", ATTR_POLICY));
  return out;
}

function resourceAttrs(): OtlpAttribute[] {
  return [
    { key: "service.name", value: { stringValue: "claude-code" } },
    { key: "service.version", value: { stringValue: getClaudeCodeVersion() } },
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-cc" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: PLUGIN_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: os.userInfo().username } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } },
  ];
}

export function buildOtlpPayload(args: {
  event: BaseEvent;
  traceId: string; // ULID (26 chars)
  now?: number; // ms since epoch; injectable for tests
  guard?: GuardResult | null;
}): OtlpPayload {
  return buildPayload({
    traceId: args.traceId,
    spanName: `cc.${snakeCase(args.event.hook_event_name)}`,
    attributes: flattenEvent(args.event),
    resource: resourceAttrs(),
    scope: { name: "pinta-cc", version: PLUGIN_VERSION },
    now: args.now,
    guard: args.guard,
  });
}
