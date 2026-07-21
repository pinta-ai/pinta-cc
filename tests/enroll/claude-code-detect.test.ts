import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectClaudeCode } from "../../src/enroll/claude-code-detect";

describe("detectClaudeCode", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-home-"));
  });
  afterEach(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  it("returns empty array when ~/.claude.json does not exist", async () => {
    const result = await detectClaudeCode({ homeDir: tmpHome, platform: "darwin" });
    expect(result).toEqual([]);
  });

  it("detects user scope + each project local scope + project-file scopes", async () => {
    // Seed ~/.claude.json with one user-scope server and two projects
    const projectA = path.join(tmpHome, "work", "repo-a");
    const projectB = path.join(tmpHome, "work", "repo-b");
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    // Project A has a .mcp.json (team-shared)
    fs.writeFileSync(
      path.join(projectA, ".mcp.json"),
      JSON.stringify({ mcpServers: { teamA: { command: "node" } } }),
    );
    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify({
        mcpServers: { userSrv: { command: "npx", args: ["-y", "u"] } },
        projects: {
          [projectA]: {
            mcpServers: { localA: { command: "node", args: ["a.js"] } },
          },
          [projectB]: {
            mcpServers: {},
          },
        },
      }),
    );

    const result = await detectClaudeCode({ homeDir: tmpHome, platform: "darwin" });
    // Expected: user + local(A) + project(A). B has empty local + no .mcp.json → not included.
    expect(result).toHaveLength(3);
    const user = result.find((r) => r.displayPath === "global");
    const local = result.find((r) => r.displayPath?.startsWith("local:"));
    const project = result.find((r) => r.displayPath?.startsWith("project:"));
    expect(user).toBeDefined();
    expect(local).toBeDefined();
    expect(project).toBeDefined();
    expect(user!.client).toBe("claude-code");
    expect(Object.keys(user!.servers)).toEqual(["userSrv"]);
    expect(local!.scopePath).toEqual(["projects", projectA]);
    expect(Object.keys(local!.servers)).toEqual(["localA"]);
    expect(project!.configPath).toBe(path.join(projectA, ".mcp.json"));
    expect(project!.scopePath).toEqual([]);
    expect(Object.keys(project!.servers)).toEqual(["teamA"]);
  });

  it("returns only user scope when projects key absent", async () => {
    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify({ mcpServers: { s: { command: "node" } } }),
    );
    const result = await detectClaudeCode({ homeDir: tmpHome, platform: "darwin" });
    expect(result).toHaveLength(1);
    expect(result[0].displayPath).toBe("global");
  });

  it("returns user with empty servers when mcpServers missing", async () => {
    fs.writeFileSync(path.join(tmpHome, ".claude.json"), JSON.stringify({ projects: {} }));
    const result = await detectClaudeCode({ homeDir: tmpHome, platform: "darwin" });
    expect(result).toHaveLength(1);
    expect(result[0].servers).toEqual({});
  });
});
