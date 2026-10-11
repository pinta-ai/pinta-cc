import { attachGuard, buildNotice, buildOutputDenial } from "@pinta-ai/core";
import type { GuardResult } from "@pinta-ai/core";
import type { PintaConfig } from "../core/config.js";
import type { PostToolBatchEvent, PostToolUseEvent, PostToolUseFailureEvent } from "../core/types.js";
import { evaluateGuard } from "../core/guard.js";
import { returnedText } from "../core/returned-text.js";
import { buildEventPayload, deferPayload, emitEvent, sendPayload } from "./shared.js";

// Claude Code caps `updatedToolOutput` at 10,000 characters (>= 2.1.265). The
// masked text is cut below that so the truncation marker core appends after the
// cut still fits, and the model is told it is looking at a partial output
// rather than being handed a silently shortened one.
export const UPDATED_TOOL_OUTPUT_LIMIT = 9_900;

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

  // The tool already ran, so the session stays alive and the model gets the
  // policy's own message plus a recovery hint instead of the denied output
  // (PTA-695). Printed before any telemetry: a host timeout can discard even an
  // already-written response if the hook then waits on a collector.
  if (guard?.decision === "DENY") {
    process.stdout.write(JSON.stringify(outputDenialResponse(event, guard)) + "\n");
  }

  try {
    // `attachGuard` copies the verdict, never `redactions` — the matched values
    // travel only in the loopback response and must not reach the span.
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

/**
 * The one JSON line Claude Code reads for a denied output.
 *
 * - `mask` (manager 0.1.16+ sent the detected values and every signal the rule
 *   read carried one): the model receives the output with just those values
 *   replaced, via `hookSpecificOutput.updatedToolOutput`, and the notice +
 *   guidance as `additionalContext`. No `decision`, so the turn continues.
 * - `withhold` (older manager, explicit withhold, or a mask whose values are not
 *   in the text): `decision: "block"` puts the notice in front of the model as
 *   the block reason, and `updatedToolOutput` replaces the original result with
 *   the withheld line so the denied content is not delivered either way.
 * - PostToolBatch has no replacement channel: `decision: "block"` with the
 *   notice only.
 */
function outputDenialResponse(
  event: PostToolUseEvent | PostToolBatchEvent,
  guard: GuardResult,
): Record<string, unknown> {
  if (event.hook_event_name === "PostToolBatch") {
    return { decision: "block", reason: buildNotice(guard.userMessage, guard.evaluationId) };
  }

  const denial = buildOutputDenial({
    original: returnedText(event.tool_response),
    guard,
    limit: UPDATED_TOOL_OUTPUT_LIMIT,
  });

  if (denial.action === "mask") {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: denial.text,
        additionalContext: `${denial.notice}\n${denial.guidance}`,
      },
    };
  }

  return {
    decision: "block",
    reason: denial.notice,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: denial.text,
      additionalContext: denial.guidance,
    },
  };
}
