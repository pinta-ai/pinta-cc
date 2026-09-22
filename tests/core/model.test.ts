import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOtlpPayload } from "../../src/core/otlp";
import { resolveModel } from "../../src/core/model";
import type { BaseEvent } from "../../src/core/types";

vi.mock("../../src/core/claude-version.js", () => ({
  getClaudeCodeVersion: () => "2.3.4",
}));

const NOW = Date.parse("2026-09-21T12:00:00Z");
const TRACE = "01HQXM7Y9YZJ8MK7Z6P3X1V8R0";
let directory: string;
let transcript: string;

beforeEach(() => {
  directory = path.resolve(".model-tests", randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  transcript = path.join(directory, "session-1.jsonl");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function write(records: unknown[]) {
  fs.writeFileSync(transcript, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function response(model: unknown = "response-model", tool = "call-1", overrides: Record<string, unknown> = {}) {
  return {
    type: "assistant", sessionId: "session-1", timestamp: new Date(NOW - 1_000).toISOString(),
    message: { role: "assistant", model, content: [{ type: "tool_use", id: tool }] },
    ...overrides,
  };
}

function attributes(overrides: Record<string, unknown> = {}) {
  const event: BaseEvent = {
    hook_event_name: "PostToolUse",
    session_id: "session-1",
    transcript_path: transcript,
    tool_use_id: "call-1",
    cwd: directory,
    timestamp: NOW,
    ...overrides,
  };
  return buildOtlpPayload({ event, traceId: TRACE, now: NOW })
    .resourceSpans[0].scopeSpans[0].spans[0].attributes;
}

function value(attrs: ReturnType<typeof attributes>, key: string) {
  return attrs.find((attribute) => attribute.key === `cc.${key}`)?.value;
}

describe("model evidence", () => {
  it("fills the missing hook model from the assistant that requested this exact tool", () => {
    write([
      { type: "assistant", sessionId: "session-1", timestamp: new Date(NOW - 1_000).toISOString(), message: { role: "assistant", model: "response-model", content: [{ type: "tool_use", id: "call-1" }] } },
    ]);
    const attrs = attributes();
    expect(value(attrs, "model")).toEqual({ stringValue: "response-model" });
    expect(value(attrs, "model_source")).toEqual({ stringValue: "transcript.assistant.message" });
  });

  it("normalizes a host model descriptor to its exact ID instead of JSON", () => {
    expect(value(attributes({ model: { id: "host-model", name: "Display name" } }), "model"))
      .toEqual({ stringValue: "host-model" });
  });

  it("preserves explicit host source/provider and requested/response evidence", () => {
    const attrs = attributes({
      model: " exact-model ", model_source: "host.response", model_provider: "host-provider",
      requested_model: "requested-model", response_model: "exact-model",
    });
    expect(value(attrs, "model")).toEqual({ stringValue: "exact-model" });
    expect(value(attrs, "model_source")).toEqual({ stringValue: "host.response" });
    expect(value(attrs, "model_provider")).toEqual({ stringValue: "host-provider" });
    expect(value(attrs, "requested_model")).toEqual({ stringValue: "requested-model" });
    expect(value(attrs, "response_model")).toEqual({ stringValue: "exact-model" });
  });

  it.each(["", "  ", "unknown", "UNKNOWN", "null", "undefined", "n/a", "none"])(
    "omits the model placeholder %j",
    (model) => {
      expect(value(attributes({ model }), "model")).toBeUndefined();
    },
  );

  it("prefers explicit host evidence without transcript IO", () => {
    const open = vi.spyOn(fs, "openSync");
    expect(resolveModel({ hook_event_name: "PostToolUse", session_id: "session-1", cwd: directory, transcript_path: transcript, model: " host-model " }, NOW))
      .toEqual({ name: "host-model", source: "hook.model" });
    expect(open).not.toHaveBeenCalled();
  });

  it("enriches placeholders but never overrides an explicit host model", () => {
    write([response()]);
    expect(value(attributes({ model: "unknown" }), "model")).toEqual({ stringValue: "response-model" });
    expect(value(attributes({ model: "explicit-model" }), "model")).toEqual({ stringValue: "explicit-model" });
  });

  it("retains the original source when a transcript replaces unusable host model evidence", () => {
    write([response()]);
    const attrs = attributes({ model: "unknown", model_source: "host.selection" });
    expect(value(attrs, "model_source")).toEqual({ stringValue: "transcript.assistant.message" });
    expect(value(attrs, "model_original_source")).toEqual({ stringValue: "host.selection" });
  });

  it("uses the requesting assistant rather than a newer or future response", () => {
    write([
      response("earlier"), response("later", "call-2", { timestamp: new Date(NOW - 100).toISOString() }),
      response("future", "call-1", { timestamp: new Date(NOW + 1).toISOString() }),
    ]);
    expect(value(attributes(), "model")).toEqual({ stringValue: "earlier" });
    expect(value(attributes({ tool_use_id: "call-2" }), "model")).toEqual({ stringValue: "later" });
  });

  it("requires the same session and exact tool ID, not tool names or prose", () => {
    write([response("another-session", "call-1", { sessionId: "session-2" }), response("another-tool", "call-2")]);
    expect(value(attributes(), "model")).toBeUndefined();
    expect(value(attributes({ tool_use_id: undefined }), "model")).toBeUndefined();
    write([{ type: "user", sessionId: "session-1", timestamp: new Date(NOW - 100).toISOString(), message: { model: "user-prose", content: [{ type: "tool_use", id: "call-1" }] } }]);
    expect(value(attributes(), "model")).toBeUndefined();
  });

  it("does not attach a subagent's model to parent tools", () => {
    write([response("child-model", "call-1", { agentId: "child-1", isSidechain: true })]);
    expect(value(attributes(), "model")).toBeUndefined();
    expect(value(attributes({ agent_id: "child-2" }), "model")).toBeUndefined();
    expect(value(attributes({ agent_id: "child-1" }), "model")).toEqual({ stringValue: "child-model" });
    write([response("parent-model"), response("child-model", "call-1", { agentId: "child-1", isSidechain: true })]);
    expect(value(attributes(), "model")).toEqual({ stringValue: "parent-model" });
  });

  it("uses a session-bound subagent transcript path when hooks omit agent_id", () => {
    const subagents = path.join(directory, "session-1", "subagents");
    fs.mkdirSync(subagents, { recursive: true });
    transcript = path.join(subagents, "agent-child-1.jsonl");
    write([response("child-model", "call-1", { agentId: "child-1", isSidechain: true })]);
    expect(value(attributes(), "model")).toEqual({ stringValue: "child-model" });
    expect(value(attributes({ agent_id: "child-2" }), "model")).toBeUndefined();
    expect(value(attributes({ session_id: "session-2" }), "model")).toBeUndefined();
  });

  it("rejects sidechains with missing or invalid identity", () => {
    write([response("sidechain", "call-1", { isSidechain: true })]);
    expect(value(attributes(), "model")).toBeUndefined();
    write([response("invalid-agent", "call-1", { agentId: 42 })]);
    expect(value(attributes(), "model")).toBeUndefined();
    write([response("parent-model")]);
    expect(value(attributes({ agent_type: "Explore" }), "model")).toBeUndefined();
  });

  it("does not carry a SessionStart model into later hooks or infer Stop's latest model", () => {
    expect(value(attributes({ hook_event_name: "SessionStart", model: "selected-model" }), "model")).toEqual({ stringValue: "selected-model" });
    expect(value(attributes({ tool_use_id: undefined }), "model")).toBeUndefined();
    write([response()]);
    for (const hook_event_name of ["Stop", "SubagentStart", "SubagentStop", "SessionEnd", "UserPromptSubmit"]) {
      expect(value(attributes({ hook_event_name }), "model")).toBeUndefined();
    }
  });

  it("supports the gate/result/failure tool hooks without changing their routing", () => {
    write([response()]);
    for (const hook_event_name of ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"]) {
      expect(value(attributes({ hook_event_name }), "model")).toEqual({ stringValue: "response-model" });
    }
  });

  it("omits conflicting or incomplete evidence for one tool", () => {
    write([response("one"), response("two")]);
    expect(value(attributes(), "model")).toBeUndefined();
    write([response("one"), response("unknown")]);
    expect(value(attributes(), "model")).toBeUndefined();
    write([response("one"), response("one")]);
    expect(value(attributes(), "model")).toEqual({ stringValue: "one" });
  });

  it("does not share model state across sessions or file rewrites", () => {
    write([response("one")]);
    expect(value(attributes(), "model")).toEqual({ stringValue: "one" });
    write([response("two", "call-1", { sessionId: "session-2" })]);
    expect(value(attributes(), "model")).toBeUndefined();
    expect(value(attributes({ session_id: "session-2" }), "model")).toEqual({ stringValue: "two" });
  });

  it.each([
    { session_id: "../outside" }, { session_id: "" }, { tool_use_id: "" }, { agent_id: 123 },
    { timestamp: "invalid" }, { timestamp: NOW + 1 }, { timestamp: null },
    { transcript_path: "" }, { transcript_path: "relative.jsonl" },
  ])("omits invalid attribution metadata %j", (overrides) => {
    write([response()]);
    expect(value(attributes(overrides), "model")).toBeUndefined();
  });

  it("ignores incomplete trailing lines and fails quietly on malformed complete records", () => {
    write([response("one")]);
    fs.appendFileSync(transcript, JSON.stringify(response("two")));
    expect(value(attributes(), "model")).toEqual({ stringValue: "one" });
    fs.appendFileSync(transcript, "broken\n");
    expect(value(attributes(), "model")).toBeUndefined();
  });

  it("does not substitute a recent model when the exact tool is outside the bounded tail", () => {
    write([response("old"), { content: "x".repeat(2 * 1024 * 1024) }, response("recent", "call-2")]);
    expect(value(attributes(), "model")).toBeUndefined();
    expect(value(attributes({ tool_use_id: "call-2" }), "model")).toEqual({ stringValue: "recent" });
  });

  it("does not derive a model from global settings, agent name, version or prose", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "global-default");
    expect(value(attributes({ agent_type: "claude-agent", cli_version: "2.1.3", prompt: "use prose-model" }), "model")).toBeUndefined();
  });

  it("leaves the raw event unchanged, keeps one span and preserves redaction", () => {
    const secret = "sk-" + "a".repeat(48);
    const event: BaseEvent = Object.freeze({ hook_event_name: "PostToolUse", session_id: "s", cwd: directory, transcript_path: transcript, model: Object.freeze({ id: "host-model" }), tool_input: Object.freeze({ api_key: secret }) });
    const payload = buildOtlpPayload({ event, traceId: TRACE, now: NOW });
    expect(event.model).toEqual({ id: "host-model" });
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(value(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes, "model")).toEqual({ stringValue: "host-model" });
  });
});
