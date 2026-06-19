"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStop = handleStop;
const shared_js_1 = require("./shared.js");
async function handleStop(event, config) {
    await (0, shared_js_1.emitEvent)(event, config);
    return 0;
}
//# sourceMappingURL=stop.js.map