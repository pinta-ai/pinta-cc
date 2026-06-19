import type { PintaConfig } from "../core/config.js";
import type { BaseEvent } from "../core/types.js";
import type { GuardResult } from "../core/guard.js";
/**
 * Shared transport flow used by every hook handler: flush any queued payloads,
 * resolve the trace id, build the OTLP payload, and send it.
 *
 * `traceMode` selects the trace boundary semantics:
 *   - "current": reuse the session's in-flight trace (the default for all
 *     mid-turn hooks).
 *   - "new": rotate a fresh trace — used only by UserPromptSubmit, which marks
 *     the start of a new user turn.
 *
 * `guard` is forwarded into the payload so PreToolUse can attach its
 * pinta.guard.* attributes; it is null for every other hook.
 */
export declare function emitEvent(event: BaseEvent, config: PintaConfig, opts?: {
    traceMode?: "current" | "new";
    guard?: GuardResult | null;
}): Promise<void>;
