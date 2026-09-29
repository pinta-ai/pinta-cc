import { attachGuard } from "@pinta-ai/core";
import type { PintaConfig } from "../core/config.js";
import type { PermissionEvent } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { buildEventPayload, deferPayload, emitEvent, sendPayload } from "./shared.js";

export async function handlePermission(
  event: PermissionEvent,
  config: PintaConfig,
): Promise<number> {
  if (event.hook_event_name === "PermissionDenied") {
    await emitEvent(event, config);
    return 0;
  }

  const payload = buildEventPayload(event, config);
  const guard = await evaluateGuard(payload, process.env.PINTA_GUARD_ENDPOINT);

  if (guard?.decision === "DENY") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: guard.userMessage ?? guard.reason ?? "guard_deny",
        },
      },
    }) + "\n");
  }

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
