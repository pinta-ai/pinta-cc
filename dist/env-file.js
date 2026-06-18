"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEnvFile = void 0;
exports.envFilePath = envFilePath;
exports.loadEnvFile = loadEnvFile;
/**
 * Graceful env-file loader (cc binding over @pinta-ai/core).
 *
 * Pinta Manager v0.1.6+ writes `~/.claude/pinta-cc.env` (KEY=VALUE per line)
 * instead of prefixing the hook command with a POSIX shell env prefix
 * (`KEY='val' node ...`), which is broken on native Windows shells. The parser
 * and merge semantics (only fill unset keys; silent no-op on missing file) live
 * in the shared package; this module just binds the cc path.
 */
const core_1 = require("@pinta-ai/core");
Object.defineProperty(exports, "parseEnvFile", { enumerable: true, get: function () { return core_1.parseEnvFile; } });
function envFilePath() {
    return (0, core_1.envFilePath)(".claude", "pinta-cc.env");
}
function loadEnvFile(filePath = envFilePath()) {
    (0, core_1.loadEnvFile)(filePath);
}
//# sourceMappingURL=env-file.js.map