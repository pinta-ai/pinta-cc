"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transport = void 0;
// cc-specific binding over the shared DiskTransport in @pinta-ai/core. Keeps the
// `new Transport(config)` call shape used by the handlers. Endpoint/headers are
// resolved from the standard OTEL_EXPORTER_OTLP_* env vars (the shared
// envOptionsResolver default), which env-bridge.ts populates at startup.
const core_1 = require("@pinta-ai/core");
class Transport extends core_1.DiskTransport {
    constructor(config) {
        super({ pluginData: config.pluginData, logPrefix: "pinta-cc" });
    }
}
exports.Transport = Transport;
//# sourceMappingURL=transport.js.map