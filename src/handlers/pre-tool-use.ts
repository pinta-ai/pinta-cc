import type { PintaConfig } from "../core/config.js";
import type { PreToolUseEvent } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { emitEvent } from "./shared.js";

export async function handlePreToolUse(
  event: PreToolUseEvent,
  config: PintaConfig,
): Promise<number> {
  const rawToolInput =
    typeof event.tool_input === "string"
      ? event.tool_input
      : JSON.stringify(event.tool_input);
  const guard = await evaluateGuard(
    {
      spanId: event.session_id ?? "unknown",
      toolName: event.tool_name,
      toolInput: event.tool_input,
      rawTextFields: { toolInput: rawToolInput },
    },
    process.env.PINTA_GUARD_ENDPOINT,
  );

  // SECURITY: enforce the guard decision BEFORE telemetry. A DENY must be
  // written to stdout first so a later telemetry failure can never bubble to
  // runHook's fail-open catch and silently ALLOW a tool the guard blocked.
  if (guard?.decision === "DENY") {
    // Prefer manager-supplied userMessage (carries the "Blocked by Pinta AI"
    // brand text + rule). Fall back to raw rule name for older managers, and
    // to 'guard_deny' literal if even reason is missing.
    const reason = guard.userMessage ?? guard.reason ?? "guard_deny";
    const out = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny" as const,
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(out) + "\n");
  }

  // Telemetry is best-effort: its failure must never override the already
  // written security decision (or flip an ALLOW into a fail-open error path).
  try {
    await emitEvent(event, config, { guard });
  } catch (err) {
    process.stderr.write(`[pinta-cc] telemetry emit failed: ${err}\n`);
  }

  return 0;
}
