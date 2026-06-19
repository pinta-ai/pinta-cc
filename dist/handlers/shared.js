"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitEvent = emitEvent;
const transport_js_1 = require("../core/transport.js");
const trace_js_1 = require("../core/trace.js");
const otlp_js_1 = require("../core/otlp.js");
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
async function emitEvent(event, config, opts = {}) {
    const transport = new transport_js_1.Transport(config);
    await transport.flush();
    const traces = new trace_js_1.TraceManager(config);
    const traceId = opts.traceMode === "new" ? traces.newTrace() : traces.currentTrace();
    const payload = (0, otlp_js_1.buildOtlpPayload)({ event, traceId, guard: opts.guard });
    await transport.send(payload);
}
//# sourceMappingURL=shared.js.map