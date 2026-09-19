import { hasOtlpEndpoint, type PintaConfig } from "../core/config.js";
import type { BaseEvent } from "../core/types.js";
import type { OtlpPayload } from "@pinta-ai/core";
import { Transport } from "../core/transport.js";
import { TraceManager } from "../core/trace.js";
import { buildOtlpPayload } from "../core/otlp.js";

/**
 * The span for a hook event, before anything has been decided about it.
 *
 * Split out of `emitEvent` so a gating handler can build the payload, ask the
 * guard about that very object, attach the verdict, and then send it — the
 * manager judges the span the backend will store, not a second reading of the
 * event. Non-gating handlers go straight through `emitEvent`.
 *
 * `traceMode` selects the trace boundary semantics:
 *   - "current": reuse the session's in-flight trace (the default for all
 *     mid-turn hooks).
 *   - "new": rotate a fresh trace — used only by UserPromptSubmit, which marks
 *     the start of a new user turn.
 */
export function buildEventPayload(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new" } = {},
): OtlpPayload {
  const traces = new TraceManager(config);
  const traceId = opts.traceMode === "new" ? traces.newTrace() : traces.currentTrace();
  return buildOtlpPayload({
    event,
    traceId,
    versionCacheDir: config.pluginData,
  });
}

/**
 * Flush any queued payloads, then send this one. A no-op without an OTLP
 * endpoint (the OSS "guard only" or "nothing configured" paths).
 */
export async function sendPayload(payload: OtlpPayload, config: PintaConfig): Promise<void> {
  if (!hasOtlpEndpoint()) return;
  const transport = new Transport(config);
  await transport.flush();
  await transport.send(payload);
}

/**
 * Shared transport flow used by every non-gating hook handler: resolve the
 * trace id, build the OTLP payload, flush the queue, send it.
 */
export async function emitEvent(
  event: BaseEvent,
  config: PintaConfig,
  opts: { traceMode?: "current" | "new" } = {},
): Promise<void> {
  if (!hasOtlpEndpoint()) return;
  await sendPayload(buildEventPayload(event, config, opts), config);
}
