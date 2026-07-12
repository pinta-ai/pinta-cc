/**
 * Shared Claude Code hook dispatch logic: stdin -> JSON event -> handler ->
 * exit code. Factored out of src/index.ts (A3, dual-entry) so both build
 * targets share one implementation instead of drifting:
 *   - dist/index.js  (CJS, built from src/index.ts)  — always direct-exec.
 *   - dist/index.mjs (ESM, built from src/index.mts) — direct-exec guarded,
 *     plus a named `lifecycle` export for the pinta-manager sidecar.
 *
 * `runHook()` deliberately does NOT call `process.exit()` itself — each
 * entry point owns exiting the process with the returned code.
 */
import { bridgeUserConfigToOtelEnv } from "./core/env-bridge.js";
import { loadConfig } from "./core/config.js";
import {
  isPreToolUseEvent,
  isPostToolUseEvent,
  isUserPromptSubmitEvent,
  isSessionEvent,
  isSubagentEvent,
  isStopEvent,
  isPermissionEvent,
  isSkippedHook,
} from "./core/types.js";
import type { BaseEvent } from "./core/types.js";
import { handlePreToolUse } from "./handlers/pre-tool-use.js";
import { handlePostToolUse } from "./handlers/post-tool-use.js";
import { handleUserPrompt } from "./handlers/user-prompt.js";
import { handleSession } from "./handlers/session.js";
import { handleSubagent } from "./handlers/subagent.js";
import { handleStop } from "./handlers/stop.js";
import { handlePermission } from "./handlers/permission.js";
import { handleDefault } from "./handlers/default.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function runHook(): Promise<number> {
  // Bridge CLAUDE_PLUGIN_OPTION_* → OTEL_EXPORTER_OTLP_* FIRST before any other logic.
  // Explicit OTel env vars take precedence over the bridge.
  bridgeUserConfigToOtelEnv();

  let exitCode = 0;

  try {
    const config = loadConfig();
    const raw = await readStdin();
    const event: BaseEvent = JSON.parse(raw);

    if (isSkippedHook(event)) {
      exitCode = await handleDefault(event);
    } else if (isPreToolUseEvent(event)) {
      exitCode = await handlePreToolUse(event, config);
    } else if (isPostToolUseEvent(event)) {
      exitCode = await handlePostToolUse(event, config);
    } else if (isUserPromptSubmitEvent(event)) {
      exitCode = await handleUserPrompt(event, config);
    } else if (isSessionEvent(event)) {
      exitCode = await handleSession(event, config);
    } else if (isSubagentEvent(event)) {
      exitCode = await handleSubagent(event, config);
    } else if (isStopEvent(event)) {
      exitCode = await handleStop(event, config);
    } else if (isPermissionEvent(event)) {
      exitCode = await handlePermission(event, config);
    } else {
      exitCode = await handleDefault(event);
    }
  } catch (err) {
    process.stderr.write(`[pinta-cc] error: ${err}\n`);
    exitCode = 0; // top-level catch-all stays fail-open per spec §6
  }

  return exitCode;
}
