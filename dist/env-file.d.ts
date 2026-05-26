export declare function envFilePath(): string;
export declare function parseEnvFile(content: string): Record<string, string>;
/**
 * Load `~/.claude/pinta-cc.env` (if it exists) and merge any missing keys into
 * `process.env`. Returns silently on missing file or any read/parse error —
 * this is startup-time best-effort, and the adaptor must keep working against
 * a v0.1.5 manager that still uses the shell-prefix path.
 */
export declare function loadEnvFile(filePath?: string): void;
