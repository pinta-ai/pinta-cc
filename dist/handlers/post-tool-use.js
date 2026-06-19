"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePostToolUse = handlePostToolUse;
const shared_js_1 = require("./shared.js");
async function handlePostToolUse(event, config) {
    await (0, shared_js_1.emitEvent)(event, config);
    return 0;
}
//# sourceMappingURL=post-tool-use.js.map