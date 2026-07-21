// Ported verbatim from pinta-manager `sidecar/src/enroll/node-binary.ts`.
// Shared helpers for rewriting the `node` token at the head of hook commands
// (pinta-cc settings hooks, pinta-codex hooks.json) so the manager can swap in
// the bundled Node binary when a system `node` isn't available.
//
// Hook templates ship with `command: "node ${...PLUGIN_ROOT}/dist/index.js"`.
// The runner decides per launch whether to leave `node` as-is (system Node
// detected via `node --version`) or to substitute it with the absolute path
// of the bundled Tauri sidecar Node binary (process.execPath on mac/win).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SAFE_PATH_RE = /^[A-Za-z0-9_.\-/\\:]+$/;

/**
 * Normalize a filesystem path for embedding in a hook command STRING. Hook
 * commands are shell-parsed by the runtime host (Claude Code, codex). On
 * Windows that host runs hooks through a shell where an unquoted backslash is
 * an escape character, so a path like `C:\Users\u\.pinta\…` collapses to
 * `C:Usersu.pinta…` and Node then fails to resolve the script
 * (`Cannot find module 'C:Users…'`). Forward slashes need no escaping in any
 * shell (cmd, PowerShell, bash) and Node accepts them natively on Windows for
 * both module resolution and the interpreter path, so we convert backslashes
 * to forward slashes before a path enters a command line.
 *
 * This is for command STRINGS only — env-file values (CLAUDE_PLUGIN_ROOT) and
 * MCP `command`/`args[]` entries are not shell-parsed, so they keep native
 * separators.
 */
export function toCommandPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Quote a binary path so the hook-runner shell parses it as a single argument.
 * Hook command lines are shell-parsed by the runtime host (Claude Code, codex),
 * so a path with spaces — e.g. `C:/Program Files/.../node.exe` for a bundled
 * Node, or `C:/Program Files (x86)/...` — needs explicit quoting.
 *
 * Quoting style is chosen by platform, because hooks run on the same OS the
 * manager enrolled on:
 * - Windows: double quotes. Claude Code may run a hook through cmd.exe,
 *   PowerShell, or git-bash, and double quotes are the ONE form all three
 *   honor (single quotes are literal in cmd.exe). The path is already
 *   forward-slashed (toCommandPath), so it carries no backslash/`$`/backtick to
 *   escape, and `"` is not a legal Windows path character.
 * - POSIX: single quotes — safest, no `$`/backtick interpolation.
 *
 * Bare `node` and paths without special characters are returned unchanged
 * to keep the rendered command readable.
 */
export function quoteShellPath(p: string): string {
  if (SAFE_PATH_RE.test(p)) return p;
  if (process.platform === 'win32') {
    return `"${p}"`;
  }
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Replace a leading `node` token in `command` with `nodeBinary`. The match
 * requires `node` to be the first whitespace-separated word so commands that
 * already use an absolute interpreter path (or a different runtime entirely)
 * are left alone.
 *
 * No-op when `nodeBinary === 'node'` — the rendered command would be
 * identical, so we skip the rewrite to keep diffs minimal across reapplies.
 */
export function substituteNodeBinary(command: string, nodeBinary: string): string {
  if (nodeBinary === 'node') return command;
  // Forward-slash the binary path first so a Windows `process.execPath`
  // (`C:\…\node.exe`) survives shell parsing at hook-fire time, then quote it
  // for paths that contain spaces (e.g. `C:/Program Files/…`).
  const rendered = quoteShellPath(toCommandPath(nodeBinary));
  return command.replace(/^node(\s|$)/, (_match, tail) => `${rendered}${tail}`);
}

// --- Windows .cmd hook launcher ---

/**
 * Deterministic wrapper filename for a resolved hook command. Hashing the
 * command means identical commands share one wrapper file while distinct ones
 * get distinct files; the wrapper sits inside the adaptor dir so the host's
 * manager-ownership path-prefix check still tags it ours regardless of name.
 */
export function windowsHookWrapperName(resolvedCommand: string): string {
  const sha = crypto.createHash('sha256').update(resolvedCommand).digest('hex').slice(0, 8);
  return `pinta-hook-${sha}.cmd`;
}

/**
 * Body of the `.cmd` launcher for a resolved hook command. `resolvedCommand` is
 * the forward-slashed string we would otherwise embed straight into the hook
 * config (node binary already quoted by `quoteShellPath`). We convert its
 * separators to backslashes — inside a batch file backslash is the native path
 * separator and needs no escaping — forward `%*` so any args the runner appends
 * are preserved, and propagate the child's exit code (so a PreToolUse guard
 * denial still surfaces rather than being swallowed).
 */
export function windowsHookWrapperContent(resolvedCommand: string): string {
  const native = resolvedCommand.replace(/\//g, '\\');
  return ['@echo off', `${native} %*`, 'exit /b %ERRORLEVEL%', ''].join('\r\n');
}

/**
 * On Windows, route a hook command through a `.cmd` launcher and return the
 * wrapper-path token to embed in the hook config; on other platforms return
 * `resolvedCommand` unchanged.
 *
 * Some hook runners (verified on codex; applied defensively to other clients)
 * mis-tokenize a command that begins with a quoted executable path containing
 * spaces — e.g. `"C:/Program Files/Pinta Manager/node.exe" …/index.js` — and
 * report a spurious non-zero exit, even though the identical string runs fine
 * from cmd.exe/PowerShell. Handing the runner a single bare `.cmd` token
 * sidesteps the tokenizer entirely. NOT for MCP servers — those launch via an
 * argv array (`command` + `args[]`), never a shell-parsed string, so they have
 * no quoting/tokenization to break.
 *
 * The wrapper is written into `wrapperDir` (a native path inside the adaptor
 * dir, so it is reaped with the version on upgrade and recognized as
 * manager-owned). Writing is synchronous — the file is tiny and must exist
 * before the host first fires the hook.
 */
export function maybeWrapHookCommandForWindows(
  resolvedCommand: string,
  platform: NodeJS.Platform,
  wrapperDir: string,
): string {
  if (platform !== 'win32') return resolvedCommand;
  const wrapperPath = path.join(wrapperDir, windowsHookWrapperName(resolvedCommand));
  fs.writeFileSync(wrapperPath, windowsHookWrapperContent(resolvedCommand), 'utf-8');
  // Bare token (no spaces in our adaptor path) → the runner tokenizes it
  // cleanly. quoteShellPath only quotes if the path actually contains a space.
  return quoteShellPath(toCommandPath(wrapperPath));
}

/**
 * Render a hook `command` template into the exact string to embed in a client's
 * hook config: rewrite the leading `node` token to the resolved binary, then
 * (on Windows) route through a `.cmd` launcher. Every hook-command client
 * (codex, claude-code, copilot, gemini) does exactly this pair, so they share
 * this one helper. `wrapperDir` is the manager-owned dir the `.cmd` is written
 * into (typically the adaptor package root, reaped on version upgrade).
 */
export function renderHookCommand(
  command: string,
  nodeBinary: string,
  platform: NodeJS.Platform,
  wrapperDir: string,
): string {
  return maybeWrapHookCommandForWindows(
    substituteNodeBinary(command, nodeBinary),
    platform,
    wrapperDir,
  );
}
