/**
 * ESM dual-entry (A3, plan §4.2/§4.3): built to dist/index.mjs via a
 * separate `--format=esm` esbuild step (see package.json `build:esm`).
 *
 * Exports the pinta-cc `lifecycle` TranscriptSource for the pinta-manager
 * sidecar's runtime `import()` (plan: `import(~/.pinta/adaptors/pinta-cc/…mjs)`),
 * AND still works as a direct-exec Claude Code hook — but guarded so that
 * *importing* this module (the sidecar loading the adaptor) does not also
 * read stdin / dispatch a hook / exit the process.
 *
 * dist/index.js (CJS, built from src/index.ts) remains the hook-only,
 * always-direct-exec entry point — untouched by A3.
 *
 * Guard: `import.meta.main` is Bun-only. Comparing `import.meta.url` to the
 * realpath of `process.argv[1]` works on both Node 20 and Bun, so this file
 * behaves the same regardless of which runtime eventually execs the hook.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Load ~/.claude/pinta-cc.env BEFORE any other import that may read process.env.
// See src/env-file.ts for the migration rationale (mirrors src/index.ts).
import { loadEnvFile } from "./env-file.js";
loadEnvFile();

import { runHook } from "./hook.js";
import { lifecycle } from "./lifecycle/scanner.js";

export { lifecycle };

function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    // process.argv[1] missing/unreadable (e.g. REPL, unusual host) — err on
    // the side of NOT running the hook, since that's the safer default for
    // an import()-based caller.
    return false;
  }
}

async function main(): Promise<void> {
  const exitCode = await runHook();
  process.exit(exitCode);
}

if (isDirectlyExecuted()) {
  main();
}
