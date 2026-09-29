import { attachGuard } from "@pinta-ai/core";
import type { PintaConfig } from "../core/config.js";
import type { PreToolUseEvent } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { buildEventPayload, deferPayload, sendPayload } from "./shared.js";

export async function handlePreToolUse(
  event: PreToolUseEvent,
  config: PintaConfig,
): Promise<number> {
  // The span is built BEFORE the guard is asked, and the guard is asked about
  // that span. Until core 0.8.0 the guard got a hand-picked summary of the
  // event (tool name, input, cwd, hook) beside the span that carried the same
  // facts under `cc.*` — two readings of one payload, free to drift, and they
  // did (PTA-176, PTA-207: `cwd` and the hook name were on the span and not in
  // the summary). Now there is one reading; the manager projects it through
  // the same AgentEvent assembly the backend uses to store it.
  const payload = buildEventPayload(event, config);
  const guard = await evaluateGuard(payload, process.env.PINTA_GUARD_ENDPOINT);

  // Print the native decision first, then persist locally and finish. Waiting
  // for telemetry can make the host discard even valid DENY JSON on timeout.
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

  // The verdict rides on the same span the guard judged, even when deferred.
  try {
    attachGuard(payload, guard);
    if (guard?.decision === "DENY") {
      deferPayload(payload, config);
      return 0;
    }
    await sendPayload(payload, config);
  } catch (err) {
    process.stderr.write(`[pinta-cc] telemetry emit failed: ${err}\n`);
  }

  return 0;
}
