"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSubagent = handleSubagent;
const shared_js_1 = require("./shared.js");
async function handleSubagent(event, config) {
    await (0, shared_js_1.emitEvent)(event, config);
    return 0;
}
//# sourceMappingURL=subagent.js.map