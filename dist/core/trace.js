"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceManager = void 0;
// cc-specific binding over the shared TraceManager in @pinta-ai/core. Keeps the
// `new TraceManager(config)` call shape used by the handlers.
const core_1 = require("@pinta-ai/core");
class TraceManager extends core_1.TraceManager {
    constructor(config) {
        super(config.tracePath);
    }
}
exports.TraceManager = TraceManager;
//# sourceMappingURL=trace.js.map