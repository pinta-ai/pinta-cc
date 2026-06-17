import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { BaseEvent } from "./types.js";
import { redact, truncate } from "./redact.js";
import type { GuardResult } from "./guard.js";

const PLUGIN_VERSION = "1.4.1"; // keep in sync with .claude-plugin/plugin.json

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

export interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: number }
    | { doubleValue: number }
    | { boolValue: boolean };
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
}

export interface ResourceSpans {
  resource: { attributes: OtlpAttribute[] };
  scopeSpans: Array<{
    scope: { name: string; version: string };
    spans: OtlpSpan[];
  }>;
}

export interface OtlpPayload {
  resourceSpans: ResourceSpans[];
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Convert a 26-char Crockford ULID into 32 lowercase hex chars (16 bytes)
 * suitable for an OTLP traceId. Decoding is straightforward because each
 * Crockford char carries 5 bits and 26 chars = 130 bits; we keep the low
 * 128 bits (the spec already pads timestamp+randomness into 128 bits).
 */
export function ulidToTraceId(ulid: string): string {
  if (ulid.length !== 26) {
    throw new Error(`ulidToTraceId: expected 26 chars, got ${ulid.length}`);
  }
  // Decode to a BigInt then to 16-byte big-endian buffer.
  let n = 0n;
  for (const ch of ulid) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new Error(`ulidToTraceId: invalid Crockford char "${ch}"`);
    n = (n << 5n) | BigInt(idx);
  }
  // Mask to 128 bits (drop the top 2 bits of the 130-bit decode).
  const mask = (1n << 128n) - 1n;
  n &= mask;
  // Render as 32 hex chars, lowercase.
  return n.toString(16).padStart(32, "0");
}

/** Generate a fresh 16-hex-char (8-byte) span ID. */
export function newSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
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

function maybeRedactString(key: string, raw: string): string {
  // Spec §3: truncate first, then redact.
  const truncated = truncate(raw);
  if (SKIP_REDACT_KEYS.has(key)) return truncated;
  // Bash context only applies when this key may carry shell command text.
  // flattenEvent emits cc.tool_input as a single JSON-stringified attribute
  // (no nested flattening today), so strict equality matches actual behavior.
  // If nested flattening is ever added, re-evaluate to avoid extending bash
  // context to unrelated nested keys (e.g. cc.tool_input.file_path).
  const context = key === "cc.tool_input" || key === "cc.tool_response"
    ? ("bash" as const)
    : undefined;
  return redact(truncated, { context });
}

/** Convert a JS value into an OTLP attribute value. Returns null to omit. */
function toOtlpValue(key: string, v: unknown): OtlpAttribute["value"] | null {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case "string":
      return { stringValue: maybeRedactString(key, v) };
    case "boolean":
      return { boolValue: v };
    case "number":
      if (Number.isInteger(v)) return { intValue: v };
      return { doubleValue: v };
    case "object":
      try {
        return { stringValue: maybeRedactString(key, JSON.stringify(v)) };
      } catch {
        return { stringValue: maybeRedactString(key, String(v)) };
      }
    default:
      return { stringValue: maybeRedactString(key, String(v)) };
  }
}

function snakeCase(hookEventName: string): string {
  // "PreToolUse" → "pre_tool_use"
  return hookEventName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function flattenEvent(event: BaseEvent): OtlpAttribute[] {
  const out: OtlpAttribute[] = [];
  // Discriminator first so aware-backend's detectIngestType hits it cheaply.
  out.push({ key: "ingest.type", value: { stringValue: "cc" } });
  // Always set cc.hook explicitly so server queries have a canonical key
  // regardless of incoming field name.
  out.push({ key: "cc.hook", value: { stringValue: event.hook_event_name } });
  for (const [k, v] of Object.entries(event)) {
    if (k === "hook_event_name") continue; // covered by cc.hook above
    const key = `cc.${k}`;
    const value = toOtlpValue(key, v);
    if (value === null) continue;
    out.push({ key, value });
  }
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
  const ts = args.now ?? Date.now();
  const tsNano = (BigInt(ts) * 1_000_000n).toString();
  const attrs = flattenEvent(args.event);
  if (args.guard) {
    attrs.push(
      { key: 'pinta.guard.decision', value: { stringValue: args.guard.decision.toLowerCase() } },
      { key: 'pinta.guard.duration_ms', value: { intValue: args.guard.durationMs } },
    );
    if (args.guard.reason) {
      attrs.push({ key: 'pinta.guard.matched_rule', value: { stringValue: args.guard.reason } });
    }
    if (args.guard.failOpenReason) {
      attrs.push({ key: 'pinta.guard.fail_open_reason', value: { stringValue: args.guard.failOpenReason } });
    }
  }
  const span: OtlpSpan = {
    traceId: ulidToTraceId(args.traceId),
    spanId: newSpanId(),
    name: `cc.${snakeCase(args.event.hook_event_name)}`,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: tsNano,
    endTimeUnixNano: tsNano,
    attributes: attrs,
  };
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs() },
        scopeSpans: [
          {
            scope: { name: "pinta-cc", version: PLUGIN_VERSION },
            spans: [span],
          },
        ],
      },
    ],
  };
}

/**
 * Combine multiple per-hook payloads into a single OTLP payload by
 * concatenating their resourceSpans arrays. aware-backend's parser
 * iterates over resourceSpans natively.
 */
export function mergeBatch(payloads: OtlpPayload[]): OtlpPayload {
  const out: ResourceSpans[] = [];
  for (const p of payloads) out.push(...p.resourceSpans);
  return { resourceSpans: out };
}
