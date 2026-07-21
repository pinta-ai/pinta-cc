// Claude Code MCP-config detection — this repo owns ALL Claude Code host
// knowledge (per-tool ownership). Ported from mcp-logger
// `src/enroll/claude-code.ts`, which itself came from the pinta-manager
// sidecar's `enroll/claude-code.ts`.

import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import type { McpConfigScope, McpDetectContext } from "./types.js";
import { parseMcpServers, parseTopLevelMcpServers } from "./parse-servers.js";

export function resolveClaudeCodeConfigPath(ctx: McpDetectContext): string | null {
  if (ctx.platform === "darwin" || ctx.platform === "linux" || ctx.platform === "win32") {
    return path.join(ctx.homeDir, ".claude.json");
  }
  return null;
}

/**
 * Claude Code keeps three MCP scopes: user scope (top-level `mcpServers` in
 * `~/.claude.json`), local scope (`projects[<path>].mcpServers` in the same
 * file), and project scope (`<projectPath>/.mcp.json`). One McpConfigScope per
 * scope, so the manager can wrap each independently.
 */
export async function detectClaudeCode(ctx: McpDetectContext): Promise<McpConfigScope[]> {
  const configPath = resolveClaudeCodeConfigPath(ctx);
  if (!configPath) return [];
  if (!fs.existsSync(configPath)) return [];

  let parsed: unknown;
  try {
    const raw = await fsp.readFile(configPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const results: McpConfigScope[] = [];

  // User scope — top-level mcpServers (presented as "global" in UI for parity with other clients)
  results.push({
    client: "claude-code",
    configPath,
    scopePath: [],
    displayPath: "global",
    servers: parseTopLevelMcpServers(parsed),
  });

  // Local scope — projects[<path>].mcpServers (same file, nested path)
  const projects = (parsed as { projects?: Record<string, unknown> }).projects;
  if (projects && typeof projects === "object") {
    for (const [projectPath, projectObj] of Object.entries(projects)) {
      if (!projectObj || typeof projectObj !== "object") continue;
      const localServers = parseMcpServers((projectObj as { mcpServers?: unknown }).mcpServers);
      if (Object.keys(localServers).length > 0) {
        results.push({
          client: "claude-code",
          configPath,
          scopePath: ["projects", projectPath],
          displayPath: `local: ${path.basename(projectPath)}`,
          servers: localServers,
        });
      }

      // Project scope — <projectPath>/.mcp.json (separate file)
      const projectMcpFile = path.join(projectPath, ".mcp.json");
      if (fs.existsSync(projectMcpFile)) {
        try {
          const raw2 = await fsp.readFile(projectMcpFile, "utf-8");
          const parsed2 = JSON.parse(raw2);
          results.push({
            client: "claude-code",
            configPath: projectMcpFile,
            scopePath: [],
            displayPath: `project: ${path.basename(projectPath)}`,
            servers: parseTopLevelMcpServers(parsed2),
          });
        } catch {
          // skip malformed project file
        }
      }
    }
  }

  return results;
}
