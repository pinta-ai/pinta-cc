import { attachGuard } from "@pinta-ai/core";
import type { PintaConfig } from "../core/config.js";
import type { PostToolBatchEvent, PostToolUseEvent, PostToolUseFailureEvent } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { buildEventPayload, deferPayload, emitEvent, sendPayload } from "./shared.js";

export async function handlePostToolUse(
  event: PostToolUseEvent | PostToolUseFailureEvent | PostToolBatchEvent,
  config: PintaConfig,
): Promise<number> {
  if (event.hook_event_name === "PostToolUseFailure") {
    // Claude ignores a run-stop on this event; PostToolBatch gates its result.
    await emitEvent(event, config);
    return 0;
  }

  const payload = buildEventPayload(event, config);
  const guard = await evaluateGuard(payload, process.env.PINTA_GUARD_ENDPOINT);

  // The tool already ran: stop the current run, rather than send block feedback.
  // Never echo tool content or guard messages, or wait for network telemetry
  // after DENY: a host timeout can discard even an already-written stop.
  if (guard?.decision === "DENY") {
    process.stdout.write(JSON.stringify({
      continue: false,
      stopReason: "Pinta blocked this tool output. Start a new session before continuing.",
    }) + "\n");
  }

  try {
    attachGuard(payload, guard);
    if (guard) {
      payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({
        key: "pinta.guard.target",
        value: { stringValue: "tool_output" },
      });
    }
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
