// Ported verbatim from mcp-logger `src/enroll/parse-servers.ts` (which itself
// came from the pinta-manager sidecar's MCP detection modules).

import type { McpServerEntry } from "./types.js";

/**
 * Extract well-formed `mcpServers` entries from a parsed config value.
 * Entries without a string `command` are dropped (URL-based transports and
 * malformed values are not wrappable).
 */
export function parseMcpServers(raw: unknown): Record<string, McpServerEntry> {
  if (!raw || typeof raw !== "object") return {};
  const servers: Record<string, McpServerEntry> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && "command" in value && typeof (value as { command?: unknown }).command === "string") {
      const v = value as { command: string; args?: unknown; env?: Record<string, string> };
      servers[name] = {
        command: v.command,
        args: Array.isArray(v.args) ? v.args.map(String) : undefined,
        env: v.env && typeof v.env === "object" ? { ...v.env } : undefined,
      };
    }
  }
  return servers;
}

/** Parse a config object's top-level `mcpServers` map. */
export function parseTopLevelMcpServers(parsed: unknown): Record<string, McpServerEntry> {
  if (!parsed || typeof parsed !== "object") return {};
  return parseMcpServers((parsed as { mcpServers?: unknown }).mcpServers);
}
