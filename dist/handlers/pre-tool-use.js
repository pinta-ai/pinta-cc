"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePreToolUse = handlePreToolUse;
const transport_js_1 = require("../core/transport.js");
const trace_js_1 = require("../core/trace.js");
const otlp_js_1 = require("../core/otlp.js");
const guard_js_1 = require("../core/guard.js");
async function handlePreToolUse(event, config) {
    const guardEndpoint = process.env.PINTA_GUARD_ENDPOINT;
    const rawToolInput = typeof event.tool_input === 'string'
        ? event.tool_input
        : JSON.stringify(event.tool_input);
    const guard = await (0, guard_js_1.evaluateGuard)({
        spanId: event.session_id ?? 'unknown',
        toolName: event.tool_name,
        toolInput: event.tool_input,
        rawTextFields: { toolInput: rawToolInput },
    }, guardEndpoint);
    const transport = new transport_js_1.Transport(config);
    await transport.flush();
    const traceId = new trace_js_1.TraceManager(config).currentTrace();
    const payload = (0, otlp_js_1.buildOtlpPayload)({ event, traceId, guard });
    await transport.send(payload);
    if (guard?.decision === 'DENY') {
        // Prefer manager-supplied userMessage (carries the "Blocked by Pinta AI"
        // brand text + rule). Fall back to raw rule name for older managers, and
        // to 'guard_deny' literal if even reason is missing.
        const reason = guard.userMessage ?? guard.reason ?? 'guard_deny';
        const out = {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
            },
        };
        process.stdout.write(JSON.stringify(out) + '\n');
    }
    return 0;
}
//# sourceMappingURL=pre-tool-use.js.map