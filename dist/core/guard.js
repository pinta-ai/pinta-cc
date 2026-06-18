"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateGuard = evaluateGuard;
// cc-specific binding over the shared guard in @pinta-ai/core. Preserves the
// historical cc behavior: 10s timeout, relay token + disable flag read from
// process.env, and a `pinta-cc/<version>` User-Agent.
const core_1 = require("@pinta-ai/core");
const TIMEOUT_MS = 10_000;
// Keep in sync with package.json. The manager parses `pinta-cc/<version>`.
const GUARD_UA = "pinta-cc/1.4.1";
function evaluateGuard(input, endpoint) {
    return (0, core_1.evaluateGuard)(input, endpoint, {
        timeoutMs: TIMEOUT_MS,
        token: process.env.PINTA_RELAY_TOKEN ?? "",
        disabled: process.env.PINTA_GUARD_DISABLED === "1",
        userAgent: GUARD_UA,
    });
}
//# sourceMappingURL=guard.js.map