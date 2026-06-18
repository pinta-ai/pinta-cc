/**
 * Graceful env-file loader (cc binding over @pinta-ai/core).
 *
 * Pinta Manager v0.1.6+ writes `~/.claude/pinta-cc.env` (KEY=VALUE per line)
 * instead of prefixing the hook command with a POSIX shell env prefix
 * (`KEY='val' node ...`), which is broken on native Windows shells. The parser
 * and merge semantics (only fill unset keys; silent no-op on missing file) live
 * in the shared package; this module just binds the cc path.
 */
import { parseEnvFile } from "@pinta-ai/core";
export { parseEnvFile };
export declare function envFilePath(): string;
export declare function loadEnvFile(filePath?: string): void;
