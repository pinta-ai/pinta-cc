// Ported verbatim from pinta-manager `sidecar/src/enroll/hook-ownership.ts`.
// Shared manager-ownership helpers for hook-client install modules (codex, cc,
// copilot, gemini). A hook command is "ours" when its rendered string contains
// the adaptor parent-dir prefix — version-independent, so an upgrade naturally
// supersedes older version entries. Extracted from the per-client modules so
// every hook client identifies/strips its own entries the same way (foundation
// for the HookClientProvider engine — see docs/plans/2026-06-16-ai-client-integration-design.md §4).

import path from 'node:path';
import { toCommandPath } from './node-binary.js';

/**
 * Prefix that identifies manager-owned hook entries across versions. For an
 * adaptorRoot of `~/.pinta/manager/adaptors/<id>/<version>` this returns
 * `~/.pinta/manager/adaptors/<id>/` — any hook command string containing it is
 * ours regardless of installed version, so an upgrade replaces all old entries.
 * Uses `path.sep` so Windows backslash adaptor roots match.
 */
export function adaptorPathPrefix(adaptorRoot: string): string {
  return path.dirname(adaptorRoot) + path.sep;
}

/**
 * Separator-insensitive ownership check for a rendered hook command. The
 * command carries a forward-slash path (see `toCommandPath`) while
 * `adaptorPathPrefix` uses the host `path.sep`; normalizing both also lets
 * re-enroll clean up stale backslash commands left by a pre-fix manager build.
 */
export function isManagerOwnedHookCommand(command: string, adaptorRoot: string): boolean {
  return toCommandPath(command).includes(toCommandPath(adaptorPathPrefix(adaptorRoot)));
}
