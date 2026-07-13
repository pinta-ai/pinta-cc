import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The handler mocks isolate the security-relevant ordering: guard decision vs.
// telemetry emission. Neither mock touches @pinta-ai/core, so this suite runs
// identically in CI with the real private package installed.
vi.mock("../../src/core/guard.js", () => ({
  evaluateGuard: vi.fn(),
}));
vi.mock("../../src/handlers/shared.js", () => ({
  emitEvent: vi.fn(),
}));

import { handlePreToolUse } from "../../src/handlers/pre-tool-use.js";
import { evaluateGuard } from "../../src/core/guard.js";
import { emitEvent } from "../../src/handlers/shared.js";
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
    vi.mocked(emitEvent).mockReset();
    vi.mocked(evaluateGuard).mockReset();
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
    vi.mocked(emitEvent).mockRejectedValue(new Error("disk exploded"));

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
    vi.mocked(emitEvent).mockImplementation(async () => {
      order.push("emit");
    });

    await handlePreToolUse(event, config);

    expect(order).toEqual(["stdout", "emit"]);
  });

  it("ALLOW: no permission JSON, exit 0, telemetry still emitted", async () => {
    vi.mocked(evaluateGuard).mockResolvedValue(null);
    vi.mocked(emitEvent).mockResolvedValue(undefined);

    const code = await handlePreToolUse(event, config);

    expect(code).toBe(0);
    expect(writes.some((w) => w.includes("permissionDecision"))).toBe(false);
    expect(vi.mocked(emitEvent)).toHaveBeenCalledOnce();
  });
});
