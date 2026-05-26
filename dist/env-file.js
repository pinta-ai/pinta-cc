"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.envFilePath = envFilePath;
exports.parseEnvFile = parseEnvFile;
exports.loadEnvFile = loadEnvFile;
/**
 * Graceful env-file loader.
 *
 * Pinta Manager v0.1.6+ writes `~/.claude/pinta-cc.env` (KEY=VALUE per line)
 * instead of prefixing the hook command with a POSIX shell env prefix
 * (`KEY='val' node ...`). The shell-prefix form is broken on native
 * Windows shells (cmd.exe / PowerShell). See
 * `docs/features/v0.1.6/cc-env-file.md` in pinta-manager for the migration
 * story.
 *
 * Behavior:
 * - If `~/.claude/pinta-cc.env` exists, parse it and merge into `process.env`,
 *   but only for keys that are NOT already set. This preserves any value the
 *   user explicitly exported in their shell, and also keeps the v0.1.5
 *   manager's shell-prefix values intact (since those reach us as already-set
 *   `process.env` keys).
 * - If the file is missing (old manager + new adaptor migration window), this
 *   is a silent no-op — `process.env` is left untouched and the rest of the
 *   adaptor continues to read what the shell prefix (if any) provided.
 *
 * Parser format (matches sidecar/src/enroll/codex-plugin.ts `parseEnvFile`):
 * - `KEY=VALUE` per line
 * - Blank lines and lines starting with `#` are ignored
 * - Lines without `=` are skipped (no throw)
 * - Surrounding single/double quotes on the value are stripped
 * - No escape handling — manager guarantees tokens don't contain `=` or newline
 */
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function envFilePath() {
    return node_path_1.default.join(node_os_1.default.homedir(), ".claude", "pinta-cc.env");
}
function parseEnvFile(content) {
    const out = {};
    for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const idx = line.indexOf("=");
        if (idx < 0)
            continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key)
            out[key] = value;
    }
    return out;
}
/**
 * Load `~/.claude/pinta-cc.env` (if it exists) and merge any missing keys into
 * `process.env`. Returns silently on missing file or any read/parse error —
 * this is startup-time best-effort, and the adaptor must keep working against
 * a v0.1.5 manager that still uses the shell-prefix path.
 */
function loadEnvFile(filePath = envFilePath()) {
    let content;
    try {
        content = node_fs_1.default.readFileSync(filePath, "utf-8");
    }
    catch {
        // File missing (ENOENT) or unreadable — silent no-op so the adaptor keeps
        // working against an older manager that injected env via shell prefix.
        return;
    }
    const parsed = parseEnvFile(content);
    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
//# sourceMappingURL=env-file.js.map