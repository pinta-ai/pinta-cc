import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { enroll } from "../../src/enroll/index";

describe("enroll (EnrollSource export)", () => {
  it("declares identity and both sections (pinta-cc owns all Claude Code knowledge)", () => {
    expect(enroll.id).toBe("pinta-cc");
    expect(enroll.mcp).toBeDefined();
    expect([...enroll.mcp!.clients]).toEqual(["claude-code"]);
    expect(enroll.hooks).toBeDefined();
    expect(enroll.hooks!.installType).toBe("claude-code-plugin");
  });

  it("degrades unknown clients to no scopes / null path instead of throwing", async () => {
    const ctx = { homeDir: os.tmpdir(), platform: "darwin" as NodeJS.Platform };
    await expect(enroll.mcp!.detect("cursor", ctx)).resolves.toEqual([]);
    expect(enroll.mcp!.expectedConfigPath("cursor", ctx)).toBeNull();
  });

  it("resolves the expected claude-code config path even when no file exists", () => {
    const ctx = { homeDir: "/h", platform: "darwin" as NodeJS.Platform };
    expect(enroll.mcp!.expectedConfigPath("claude-code", ctx)).toBe(path.join("/h", ".claude.json"));
  });

  it("watchPaths lists the two manager-owned Claude Code files", () => {
    expect(enroll.hooks!.watchPaths("/h")).toEqual([
      path.join("/h", ".claude", "settings.json"),
      path.join("/h", ".claude", "pinta-cc.env"),
    ]);
  });
});
