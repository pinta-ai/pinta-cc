import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPayload, type GuardResult, type OtlpPayload } from "@pinta-ai/core";
import type { PintaConfig } from "../../src/core/config.js";
import type { PermissionEvent } from "../../src/core/types.js";
import { evaluateGuard } from "../../src/core/guard.js";
import { handlePermission } from "../../src/handlers/permission.js";
import { buildEventPayload, deferPayload, emitEvent, sendPayload } from "../../src/handlers/shared.js";

vi.mock("../../src/core/guard.js", () => ({ evaluateGuard: vi.fn() }));
vi.mock("../../src/handlers/shared.js", () => ({
  buildEventPayload: vi.fn(),
  deferPayload: vi.fn(),
  emitEvent: vi.fn(),
  sendPayload: vi.fn(),
}));

const config: PintaConfig = {
  pluginRoot: "/workspace",
  pluginData: "/workspace/data",
  tracePath: "/workspace/data/trace.json",
};
const event: PermissionEvent = {
  hook_event_name: "PermissionRequest",
  session_id: "permission-session",
  transcript_path: "/workspace/absent.jsonl",
  cwd: "/workspace",
  tool_name: "Bash",
  tool_input: { command: "printf PINTA_PERMISSION_FIXTURE" },
};
const deny: GuardResult = {
  decision: "DENY",
  reason: "deny_fixture",
  userMessage: "Blocked by Pinta AI",
  durationMs: 1,
};
const response = {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: { behavior: "deny", message: deny.userMessage },
  },
};

describe("PermissionRequest enforcement", () => {
  let payload: OtlpPayload;
  let writes: string[];

  beforeEach(() => {
    vi.resetAllMocks();
    payload = buildPayload({
      traceId: "01HQXM7Y9YZJ8MK7Z6P3X1V8R0",
      spanName: "cc.permission_request",
      attributes: [
        { key: "cc.hook", value: { stringValue: event.hook_event_name } },
        { key: "cc.tool_input", value: { stringValue: JSON.stringify(event.tool_input) } },
      ],
      resource: [],
      scope: { name: "pinta-cc", version: "test" },
    });
    writes = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(buildEventPayload).mockReturnValue(payload);
    vi.mocked(evaluateGuard).mockResolvedValue(deny);
  });

  afterEach(() => vi.restoreAllMocks());

  it("evaluates the original span and denies using the native permission decision contract", async () => {
    const original = structuredClone(payload);
    expect(await handlePermission(event, config)).toBe(0);

    expect(buildEventPayload).toHaveBeenCalledWith(event, config);
    expect(evaluateGuard).toHaveBeenCalledWith(payload, process.env.PINTA_GUARD_ENDPOINT);
    expect(writes).toEqual([JSON.stringify(response) + "\n"]);
    expect(deferPayload).toHaveBeenCalledWith(payload, config);
    expect(sendPayload).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.spanId).toBe(original.resourceSpans[0].scopeSpans[0].spans[0].spanId);
    expect(span.traceId).toBe(original.resourceSpans[0].scopeSpans[0].spans[0].traceId);
    expect(span.attributes).toEqual(expect.arrayContaining(
      original.resourceSpans[0].scopeSpans[0].spans[0].attributes,
    ));
    expect(span.attributes).toContainEqual({
      key: "pinta.guard.decision", value: { stringValue: "deny" },
    });
    expect(span.attributes.some((attr) => attr.key === "pinta.guard.target")).toBe(false);
  });

  it("emits DENY before local persistence and never waits for collector IO", async () => {
    vi.mocked(deferPayload).mockImplementation(() => {
      expect(writes).toEqual([JSON.stringify(response) + "\n"]);
      throw new Error("local queue unavailable");
    });

    expect(await handlePermission(event, config)).toBe(0);
    expect(writes).toEqual([JSON.stringify(response) + "\n"]);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("local queue unavailable"));
    expect(sendPayload).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it.each(["ALLOW", "REVIEW", null] as const)(
    "%s falls through without approving or denying native permission",
    async (decision) => {
      vi.mocked(evaluateGuard).mockResolvedValue(decision ? { ...deny, decision } : null);
      expect(await handlePermission(event, config)).toBe(0);
      expect(evaluateGuard).toHaveBeenCalledOnce();
      expect(writes).toEqual([]);
      expect(deferPayload).not.toHaveBeenCalled();
      expect(sendPayload).toHaveBeenCalledWith(payload, config);
    },
  );

  it.each([null, "deny_rule"] as const)("uses a safe fallback when userMessage is absent (%s)", async (reason) => {
    vi.mocked(evaluateGuard).mockResolvedValue({ ...deny, userMessage: null, reason });
    expect(await handlePermission(event, config)).toBe(0);
    expect(JSON.parse(writes[0])).toEqual({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: reason ?? "guard_deny" },
      },
    });
  });

  it("keeps PermissionDenied observation-only", async () => {
    const denied = { ...event, hook_event_name: "PermissionDenied" as const };
    expect(await handlePermission(denied, config)).toBe(0);
    expect(emitEvent).toHaveBeenCalledWith(denied, config);
    expect(evaluateGuard).not.toHaveBeenCalled();
    expect(buildEventPayload).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("keeps non-denying telemetry errors nonblocking", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue({ ...deny, decision: "REVIEW" });
    vi.mocked(sendPayload).mockRejectedValue(new Error("collector unavailable"));
    expect(await handlePermission(event, config)).toBe(0);
    expect(writes).toEqual([]);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining("collector unavailable"));
  });
});
