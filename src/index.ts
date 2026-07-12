// Load ~/.claude/pinta-cc.env BEFORE any other import that may read process.env.
// Manager v0.1.6+ writes the env file; v0.1.5 (shell-prefix) still works because
// loadEnvFile only fills in unset keys. See src/env-file.ts for the migration
// rationale.
import { loadEnvFile } from "./env-file.js";
loadEnvFile();

// CJS hook entry (built to dist/index.js) — always direct-exec, unguarded,
// exactly as before A3. Dispatch logic itself lives in ./hook.js, shared
// with the ESM entry (src/index.mts -> dist/index.mjs) so the two build
// targets cannot drift. See src/index.mts for the ESM/dual-entry variant.
import { runHook } from "./hook.js";

async function main(): Promise<void> {
  const exitCode = await runHook();
  process.exit(exitCode);
}

main();
