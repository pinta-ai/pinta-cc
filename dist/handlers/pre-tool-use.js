"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePreToolUse = handlePreToolUse;
const guard_js_1 = require("../core/guard.js");
const shared_js_1 = require("./shared.js");
async function handlePreToolUse(event, config) {
    const rawToolInput = typeof event.tool_input === "string"
        ? event.tool_input
        : JSON.stringify(event.tool_input);
    const guard = await (0, guard_js_1.evaluateGuard)({
        spanId: event.session_id ?? "unknown",
        toolName: event.tool_name,
        toolInput: event.tool_input,
        rawTextFields: { toolInput: rawToolInput },
    }, process.env.PINTA_GUARD_ENDPOINT);
    await (0, shared_js_1.emitEvent)(event, config, { guard });
    if (guard?.decision === "DENY") {
        // Prefer manager-supplied userMessage (carries the "Blocked by Pinta AI"
        // brand text + rule). Fall back to raw rule name for older managers, and
        // to 'guard_deny' literal if even reason is missing.
        const reason = guard.userMessage ?? guard.reason ?? "guard_deny";
        const out = {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        };
        process.stdout.write(JSON.stringify(out) + "\n");
    }
    return 0;
}
//# sourceMappingURL=pre-tool-use.js.map