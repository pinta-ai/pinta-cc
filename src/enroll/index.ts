import path from "node:path";
import type { EnrollSource, McpConfigScope, McpDetectContext } from "./types.js";
import { detectClaudeCode, resolveClaudeCodeConfigPath } from "./claude-code-detect.js";
import { applyClaudeCodePlugin, removeClaudeCodePlugin } from "./claude-code-plugin.js";

/**
 * The enroll lifecycle export the pinta-manager sidecar drives (per-tool
 * ownership, troy §4.2): pinta-cc owns ALL Claude Code host knowledge —
 *
 *   - `mcp`:   where Claude Code keeps its MCP configs (`~/.claude.json`
 *              user/local scopes + per-project `.mcp.json`), consumed by the
 *              manager's generic mcp-config-wrap engine.
 *   - `hooks`: how the pinta-cc hooks are registered into
 *              `~/.claude/settings.json` (Option C) + `~/.claude/pinta-cc.env`.
 *
 * Unknown client ids degrade to no scopes / null path instead of throwing.
 */
export const enroll: EnrollSource = {
  id: "pinta-cc",

  mcp: {
    clients: ["claude-code"],

    async detect(client: string, ctx: McpDetectContext): Promise<McpConfigScope[]> {
      return client === "claude-code" ? detectClaudeCode(ctx) : [];
    },

    expectedConfigPath(client: string, ctx: McpDetectContext): string | null {
      return client === "claude-code" ? resolveClaudeCodeConfigPath(ctx) : null;
    },
  },

  hooks: {
    installType: "claude-code-plugin",
    apply: applyClaudeCodePlugin,
    remove: removeClaudeCodePlugin,
    watchPaths: (homeDir: string) => [
      path.join(homeDir, ".claude", "settings.json"),
      path.join(homeDir, ".claude", "pinta-cc.env"),
    ],
  },
};

export type {
  EnrollSource,
  McpConfigSource,
  McpConfigScope,
  McpDetectContext,
  McpServerEntry,
  EnrollContext,
  EnrollApplyResult,
  HookEnrollProvider,
} from "./types.js";
