import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPayload, type OtlpPayload } from "@pinta-ai/core";

// The handler mocks isolate the security-relevant ordering: guard decision vs.
// telemetry emission. Neither mock touches @pinta-ai/core, so this suite runs
// identically in CI with the real private package installed.
vi.mock("../../src/core/guard.js", () => ({
  evaluateGuard: vi.fn(),
}));
vi.mock("../../src/handlers/shared.js", () => ({
  buildEventPayload: vi.fn(),
  sendPayload: vi.fn(),
}));

import { handlePreToolUse } from "../../src/handlers/pre-tool-use.js";
import { evaluateGuard } from "../../src/core/guard.js";
import { buildEventPayload, sendPayload } from "../../src/handlers/shared.js";
import type { PreToolUseEvent } from "../../src/core/types.js";
import type { PintaConfig } from "../../src/core/config.js";

const config: PintaConfig = {
  pluginRoot: "/tmp",
  pluginData: "/tmp/data",
  tracePath: "/tmp/data/trace.json",
};

const event: PreToolUseEvent = {
  hook_event_name: "PreToolUse",
  session_id: "sess-1",
  tool_name: "Bash",
  tool_input: { command: "cat ~/.aws/credentials" },
} as PreToolUseEvent;

/** A real single-span payload, as `buildEventPayload` would produce. */
function freshPayload(): OtlpPayload {
  return buildPayload({
    traceId: "01HQXM7Y9YZJ8MK7Z6P3X1V8R0",
    spanName: "cc.pre_tool_use",
    attributes: [{ key: "cc.tool_name", value: { stringValue: "Bash" } }],
    resource: [],
    scope: { name: "pinta-cc", version: "0.0.0" },
  });
}

describe("handlePreToolUse — security decision vs. telemetry ordering", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let writes: string[];

  beforeEach(() => {
    writes = [];
    writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: any) => {
        writes.push(String(chunk));
        return true;
      });
    vi.mocked(sendPayload).mockReset();
    vi.mocked(evaluateGuard).mockReset();
    vi.mocked(buildEventPayload).mockReset();
    vi.mocked(buildEventPayload).mockImplementation(() => freshPayload());
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emits the DENY permission JSON even when telemetry emission throws", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue({
      decision: "DENY",
      reason: "deny_credentials",
      userMessage: "⛔ Blocked by Pinta AI — deny_credentials",
      durationMs: 8,
    } as any);
    // Telemetry blows up (disk write error, os.userInfo throwing, etc.).
    vi.mocked(sendPayload).mockRejectedValue(new Error("disk exploded"));

    const code = await handlePreToolUse(event, config);

    expect(code).toBe(0);
    const denyLine = writes.find((w) => w.includes('"permissionDecision"'));
    expect(denyLine).toBeDefined();
    const parsed = JSON.parse(denyLine!);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(
      "⛔ Blocked by Pinta AI — deny_credentials",
    );
  });

  it("writes the DENY decision BEFORE telemetry is emitted", async () => {
    const order: string[] = [];
    vi.mocked(evaluateGuard).mockResolvedValue({
      decision: "DENY",
      reason: "deny_credentials",
      userMessage: null,
      durationMs: 8,
    } as any);
    writeSpy.mockImplementation((chunk: any) => {
      if (String(chunk).includes("permissionDecision")) order.push("stdout");
      return true;
    });
    vi.mocked(sendPayload).mockImplementation(async () => {
      order.push("emit");
    });

    await handlePreToolUse(event, config);

    expect(order).toEqual(["stdout", "emit"]);
  });

  it("ALLOW: no permission JSON, exit 0, telemetry still emitted", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue(null);
    vi.mocked(sendPayload).mockResolvedValue(undefined);

    const code = await handlePreToolUse(event, config);

    expect(code).toBe(0);
    expect(writes.some((w) => w.includes("permissionDecision"))).toBe(false);
    expect(vi.mocked(sendPayload)).toHaveBeenCalledOnce();
  });
});

/**
 * One span, two readers.
 *
 * The guard used to be told a hand-picked summary of the event beside the span
 * that carried the same facts — and the summary drifted (`cwd`, the hook name:
 * PTA-176 · PTA-207). Now the guard is asked about the payload itself, and the
 * verdict is attached to that same object before it is sent, so the span the
 * manager judged is the span the backend stores, `spanId` included.
 */
describe("handlePreToolUse — the guard is asked about the span that is then sent", () => {
  beforeEach(() => {
    vi.mocked(sendPayload).mockReset();
    vi.mocked(evaluateGuard).mockReset();
    vi.mocked(buildEventPayload).mockReset();
    vi.mocked(buildEventPayload).mockImplementation(() => freshPayload());
  });

  it("builds the payload first, from the event, and hands that object to the guard", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue(null);
    await handlePreToolUse({ ...event, cwd: "/etc" } as PreToolUseEvent, config);
    expect(vi.mocked(buildEventPayload).mock.calls[0]?.[0]).toMatchObject({ cwd: "/etc", hook_event_name: "PreToolUse" });
    const built = vi.mocked(buildEventPayload).mock.results[0]?.value;
    expect(vi.mocked(evaluateGuard).mock.calls[0]?.[0]).toBe(built);
    expect(vi.mocked(sendPayload).mock.calls[0]?.[0]).toBe(built);
  });

  it("sends the judged span with the verdict attached, same spanId", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue({
      decision: "DENY",
      reason: "deny_credentials",
      userMessage: null,
      durationMs: 8,
      clientRttMs: 12,
    } as any);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await handlePreToolUse(event, config);
    const judged = vi.mocked(evaluateGuard).mock.calls[0]?.[0] as OtlpPayload;
    const sent = vi.mocked(sendPayload).mock.calls[0]?.[0] as OtlpPayload;
    expect(sent).toBe(judged);
    const span = sent.resourceSpans[0].scopeSpans[0].spans[0];
    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs["pinta.guard.decision"]).toEqual({ stringValue: "deny" });
    expect(attrs["pinta.guard.matched_rule"]).toEqual({ stringValue: "deny_credentials" });
    expect(attrs["pinta.client.rtt_ms"]).toEqual({ intValue: 12 });
    vi.restoreAllMocks();
  });
});
