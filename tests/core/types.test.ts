import { describe, expect, it } from "vitest";
import { isImportedCursorEvent, type BaseEvent } from "../../src/core/types.js";

function event(extra: Record<string, unknown> = {}): BaseEvent {
  return {
    session_id: "session-1",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp/project",
    hook_event_name: "PreToolUse",
    ...extra,
  };
}

describe("isImportedCursorEvent", () => {
  it("recognizes Cursor-imported Claude hook payloads", () => {
    expect(isImportedCursorEvent(event({ cursor_version: "3.21.16" }))).toBe(true);
  });

  it("does not skip native Claude Code payloads", () => {
    expect(isImportedCursorEvent(event())).toBe(false);
    expect(isImportedCursorEvent(event({ cursor_version: "" }))).toBe(false);
  });
});
