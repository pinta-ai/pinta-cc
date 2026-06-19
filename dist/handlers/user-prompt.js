"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUserPrompt = handleUserPrompt;
const shared_js_1 = require("./shared.js");
async function handleUserPrompt(event, config) {
    await (0, shared_js_1.emitEvent)(event, config, { traceMode: "new" }); // NEW trace per user turn
    return 0;
}
//# sourceMappingURL=user-prompt.js.map