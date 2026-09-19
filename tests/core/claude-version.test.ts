import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClaudeCodeVersion } from "../../src/core/claude-version.js";

let root: string;
let cache: string;
let stderr: ReturnType<typeof vi.spyOn>;

function write(file: string, contents: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
  return file;
}

function packageFile(dir: string, version = "2.3.4", name = "@anthropic-ai/claude-code"): void {
  write(path.join(dir, "package.json"), JSON.stringify({ name, version }));
}

function native(file = path.join(root, "native install", "claude"), body = 'console.log("2.3.4 (Claude Code)");'): string {
  const count = `${file}.calls`;
  return write(file, `#!${process.execPath}
const fs = require("node:fs");
if (process.argv.length !== 3 || process.argv[2] !== "--version") process.exit(2);
fs.appendFileSync(${JSON.stringify(count)}, "1");
${body}
`);
}

function calls(file: string): number {
  return fs.existsSync(`${file}.calls`) ? fs.readFileSync(`${file}.calls`, "utf8").length : 0;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-cc-version-"));
  cache = path.join(root, "state");
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  vi.stubEnv("PATH", "");
  vi.stubEnv("CLAUDE_CODE_EXECPATH", "");
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Claude package discovery", () => {
  it("reads the npm package instead of launching cli.js", () => {
    const dir = path.join(root, "node_modules", "@anthropic-ai", "claude-code");
    packageFile(dir);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(dir, "cli.js"), "must not execute"));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(fs.existsSync(cache)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("follows an npm symlink outside its package tree", () => {
    const dir = path.join(root, "node_modules", "@anthropic-ai", "claude-code");
    packageFile(dir);
    const target = write(path.join(dir, "cli.js"), "must not execute");
    const link = path.join(root, "claude");
    fs.symlinkSync(target, link);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", link);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("reads a pnpm .bin launcher's sibling package", () => {
    packageFile(path.join(root, "node_modules", "@anthropic-ai", "claude-code"));
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(root, "node_modules", ".bin", "claude"), "must not execute"));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("reads an npm Windows command shim's package without a shell", () => {
    packageFile(path.join(root, "node_modules", "@anthropic-ai", "claude-code"));
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(root, "claude.cmd"), "must not execute"));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("does not permanently cache npm versions across upgrades", () => {
    const dir = path.join(root, "package");
    packageFile(dir);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(dir, "cli.js"), ""));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    packageFile(dir, "2.3.5");
    expect(getClaudeCodeVersion(cache)).toBe("2.3.5");
  });

  it("does not require a home directory when an executable was provided", () => {
    const dir = path.join(root, "package");
    packageFile(dir);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(dir, "cli.js"), ""));
    vi.spyOn(os, "homedir").mockImplementation(() => { throw new Error("no passwd entry"); });
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("reports missing installations honestly, without using the Pinta version", () => {
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("no Claude executable"));
  });

  it("never executes a command shim without package metadata", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", write(path.join(root, "claude.cmd"), "must not execute"));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("command shim"));
  });
});

describe.skipIf(process.platform === "win32")("native discovery and bounded cross-hook cache", () => {
  it("probes the selected native executable, including paths with spaces", () => {
    const file = native(path.join(root, "native install", "claude "));
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(calls(file)).toBe(1);
  });

  it("supports product prerelease/build versions", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, 'console.log("2.3.4-rc.1+build.2 (Claude Code)");'));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4-rc.1+build.2");
  });

  it("allows the native CLI's cold startup to exceed one second", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, 'setTimeout(() => console.log("2.3.4 (Claude Code)"), 1100);'));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("finds Claude on PATH when the hook has no executable environment variable", () => {
    const file = native(path.join(root, "bin", "claude"));
    vi.stubEnv("PATH", path.dirname(file));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("finds the standard native install outside PATH", () => {
    native(path.join(root, ".local", "bin", "claude"));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
  });

  it("still uses PATH if the user's home directory cannot be resolved", () => {
    const file = native(path.join(root, "bin", "claude"));
    vi.stubEnv("PATH", path.dirname(file));
    vi.spyOn(os, "homedir").mockImplementation(() => { throw new Error("no passwd entry"); });
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("native install directory lookup failed"));
  });

  it("does not switch to a different CLI when the explicit executable is missing", () => {
    const other = native(path.join(root, "bin", "claude"));
    vi.stubEnv("PATH", path.dirname(other));
    vi.stubEnv("CLAUDE_CODE_EXECPATH", path.join(root, "missing"));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(calls(other)).toBe(0);
  });

  it("ignores relative PATH entries", () => {
    const file = native(path.join(root, "bin", "claude"));
    vi.stubEnv("PATH", `:${path.relative(process.cwd(), path.dirname(file))}`);
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(calls(file)).toBe(0);
  });

  it.each(["v22.3.4", "2.3.4", "2.3.4 (Some Other Product)"])("rejects non-Claude output: %s", (output) => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, `console.log(${JSON.stringify(output)});`));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("did not identify Claude Code"));
  });

  it("does not mistake another executable's neighboring npm package for its version", () => {
    packageFile(path.join(root, "node_modules", "@anthropic-ai", "claude-code"));
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(path.join(root, "node_modules", "node", "bin", "node"), 'console.log("v22.3.4");'));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
  });

  it("rejects nonzero exits and never logs child output", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, 'console.log("2.3.4 (Claude Code)"); console.error("private child output"); process.exit(1);'));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("exit 1"));
    expect(stderr.mock.calls.flat().join("")).not.toContain("private child output");
  });

  it("kills a stalled probe within a bounded interval", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'));
    const start = performance.now();
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_500);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("ETIMEDOUT"));
  });

  it("bounds probe output instead of accepting an unbounded response", () => {
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native(undefined, 'process.stdout.write("x".repeat(100000));'));
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("ENOBUFS"));
  });

  it("reuses a successful cache in memory and in a fresh module", async () => {
    const file = native();
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    vi.resetModules();
    const freshModule = await import("../../src/core/claude-version.js");
    expect(freshModule.getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(calls(file)).toBe(1);
    expect(fs.statSync(path.join(cache, "claude-version.json")).mode & 0o777).toBe(0o600);
  });

  it("invalidates a cache when the executable is updated in place", () => {
    const file = native();
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    native(file, 'console.log("2.3.5 (Claude Code)");');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 2_000));
    expect(getClaudeCodeVersion(cache)).toBe("2.3.5");
    expect(calls(file)).toBe(2);
  });

  it("invalidates a cache when a native install symlink is retargeted", () => {
    const one = native(path.join(root, "versions", "one"));
    const two = native(path.join(root, "versions", "two"), 'console.log("2.3.5 (Claude Code)");');
    const link = path.join(root, "claude");
    fs.symlinkSync(one, link);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", link);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    fs.unlinkSync(link);
    fs.symlinkSync(two, link);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.5");
    expect(calls(two)).toBe(1);
  });

  it("retries failures after 30 seconds, including across module restarts", async () => {
    const output = write(path.join(root, "output"), "not ready");
    const file = native(undefined, `console.log(fs.readFileSync(${JSON.stringify(output)}, "utf8"));`);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(getClaudeCodeVersion(cache)).toBe("unknown");
    write(output, "2.3.4 (Claude Code)");
    vi.resetModules();
    const freshModule = await import("../../src/core/claude-version.js");
    expect(freshModule.getClaudeCodeVersion(cache)).toBe("unknown");
    expect(calls(file)).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(now + 30_001);
    expect(freshModule.getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(calls(file)).toBe(2);
  });

  it("expires successful cache entries after 24 hours", () => {
    const file = native();
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60 * 1000);
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(calls(file)).toBe(2);
  });

  it.each(["not json", '[{"version":"2.3.4"}]', "x".repeat(16_385)])("recovers from corrupt cache data", (contents) => {
    write(path.join(cache, "claude-version.json"), contents);
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native());
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(stderr).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(cache, "claude-version.json"), "utf8"))).toHaveLength(1);
  });

  it("still reports the real version when cache storage is unavailable", () => {
    write(cache, "not a directory");
    vi.stubEnv("CLAUDE_CODE_EXECPATH", native());
    expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("version cache write failed"));
  });

  it("bounds the cache when multiple installations share plugin data", () => {
    for (let index = 0; index < 10; index++) {
      vi.stubEnv("CLAUDE_CODE_EXECPATH", native(path.join(root, `install-${index}`, "claude")));
      expect(getClaudeCodeVersion(cache)).toBe("2.3.4");
    }
    expect(JSON.parse(fs.readFileSync(path.join(cache, "claude-version.json"), "utf8"))).toHaveLength(8);
    expect(fs.readdirSync(cache)).toEqual(["claude-version.json"]);
  });

  it("does not launch Claude when telemetry is disabled", async () => {
    const file = native();
    vi.stubEnv("CLAUDE_CODE_EXECPATH", file);
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");
    const { emitEvent } = await import("../../src/handlers/shared.js");
    await emitEvent(
      { hook_event_name: "SessionStart", session_id: "test", transcript_path: "", cwd: root },
      { pluginRoot: root, pluginData: cache, tracePath: path.join(cache, "trace.json") },
    );
    expect(calls(file)).toBe(0);
    expect(fs.existsSync(cache)).toBe(false);
  });
});
