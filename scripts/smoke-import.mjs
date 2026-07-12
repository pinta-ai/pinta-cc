#!/usr/bin/env node
// A3 — Node 20 smoke test for the ESM dual-entry (dist/index.mjs).
//
// Two things must hold:
//   1. `lifecycle` is exported and `lifecycle.id === 'pinta-cc'`.
//   2. Importing the module must NOT run the hook's main() — which would
//      read stdin, dispatch a handler, and call process.exit(). If the
//      import.meta.url-vs-argv[1] guard in src/index.mts is broken, main()
//      fires as a side effect of module evaluation.
//
// We don't rely on timing to catch (2): `for await (chunk of process.stdin)`
// puts stdin into flowing mode synchronously as part of entering the async
// iterator, and that happens before any `await` inside main() can yield —
// so a broken guard flips `process.stdin.readableFlowing` to `true` (or
// `false`, if paused) within the SAME synchronous turn that evaluates the
// module's top level, i.e. before `await import(...)` below resolves. A
// correct guard leaves it `null` (untouched).
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(here, "..", "dist", "index.mjs");

const flowingBefore = process.stdin.readableFlowing;
if (flowingBefore !== null) {
  // Should be unreachable in a fresh process, but fail loudly rather than
  // silently invalidate the assertion below.
  console.error(
    `[smoke:import] FAIL: process.stdin.readableFlowing was already ${flowingBefore} before import — cannot assert`,
  );
  process.exit(1);
}

const mod = await import(entryPath);

const flowingAfter = process.stdin.readableFlowing;
if (flowingAfter !== null) {
  console.error(
    `[smoke:import] FAIL: importing dist/index.mjs touched process.stdin (readableFlowing=${flowingAfter}) — ` +
      "the direct-exec guard did not prevent main() from running.",
  );
  process.exit(1);
}

if (typeof mod.lifecycle === "undefined") {
  console.error("[smoke:import] FAIL: dist/index.mjs did not export `lifecycle`");
  process.exit(1);
}

if (mod.lifecycle.id !== "pinta-cc") {
  console.error(
    `[smoke:import] FAIL: lifecycle.id = ${JSON.stringify(mod.lifecycle.id)}, expected "pinta-cc"`,
  );
  process.exit(1);
}

// Extra margin: give any errantly-fired main() a tick to blow up (e.g. via
// process.exit()) before we declare success. If main() had run, we'd never
// reach this line in the first place on most CI stdin setups (closed/empty
// stdin -> immediate EOF -> JSON.parse throws -> caught -> exit(0) -- but
// the readableFlowing check above already catches that path deterministically).
await new Promise((resolve) => setTimeout(resolve, 50));

console.log(
  "[smoke:import] OK: import()-ing dist/index.mjs did not run the hook, and lifecycle.id === 'pinta-cc'",
);
process.exit(0);
