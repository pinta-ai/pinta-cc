"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSession = handleSession;
const shared_js_1 = require("./shared.js");
async function handleSession(event, config) {
    await (0, shared_js_1.emitEvent)(event, config);
    return 0;
}
//# sourceMappingURL=session.js.map