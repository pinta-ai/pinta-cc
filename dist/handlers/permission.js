"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePermission = handlePermission;
const shared_js_1 = require("./shared.js");
async function handlePermission(event, config) {
    await (0, shared_js_1.emitEvent)(event, config);
    return 0;
}
//# sourceMappingURL=permission.js.map