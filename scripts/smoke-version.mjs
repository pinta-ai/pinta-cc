import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdkVersion = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const external = process.env.PINTA_TEST_CLAUDE_BINARY;
const expected = external ? process.env.PINTA_TEST_CLAUDE_VERSION : "2.3.4";
assert.ok(expected, "PINTA_TEST_CLAUDE_VERSION is required with an external binary");
assert.ok(external || process.platform !== "win32", "On Windows, supply a real Claude binary via PINTA_TEST_CLAUDE_BINARY");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-cc-hook-version-"));
const binary = external ?? path.join(root, "native cli with spaces");
const countFile = path.join(root, "probe-count");
const payloads = [];
const timeline = [];

function fixture(file, body) {
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require("node:fs");
if (process.argv.length !== 3 || process.argv[2] !== "--version") process.exit(2);
${body}
`, { mode: 0o755 });
}

if (!external) {
  fixture(binary, `fs.appendFileSync(${JSON.stringify(countFile)}, "1"); console.log("2.3.4 (Claude Code)");`);
}

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (request.url === "/guard/evaluate") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ decision: "DENY", reason: "fixture_deny", userMessage: "fixture deny", durationMs: 1 }));
  } else if (request.url === "/v1/traces") {
    payloads.push(body);
    timeline.push("trace");
    response.writeHead(202);
    response.end();
  } else {
    response.writeHead(404);
    response.end();
  }
});

function run(entry, env, hook = "SessionStart") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, "dist", entry)], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hook did not finish: ${entry}`));
    }, 10_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes('"permissionDecision":"deny"')) timeline.push("deny");
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`hook exited ${code}: ${stderr}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.end(JSON.stringify({
      hook_event_name: hook,
      session_id: "version-smoke",
      transcript_path: "",
      cwd: root,
      tool_name: "Read",
      tool_input: { file_path: path.join(root, "fixture") },
      tool_response: "fixture",
    }));
  });
}

function assertPayload(version) {
  const payload = payloads.at(-1);
  assert.ok(payload, "the built hook must actually POST telemetry");
  const attrs = Object.fromEntries(payload.resourceSpans[0].resource.attributes.map((attr) => [attr.key, attr.value.stringValue]));
  assert.equal(attrs["service.name"], "claude-code");
  assert.equal(attrs["service.version"], version);
  assert.equal(attrs["telemetry.sdk.version"], sdkVersion);
}

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  for (const entry of ["index.js", "index.mjs"]) {
    const data = path.join(root, entry);
    const env = {
      PATH: path.dirname(process.execPath),
      HOME: root,
      USERPROFILE: root,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      CLAUDE_CONFIG_DIR: path.join(root, ".claude"),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_EXECPATH: binary,
      CLAUDE_PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_DATA: data,
      OTEL_EXPORTER_OTLP_HEADERS: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: entry === "index.js" ? endpoint : "",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: entry === "index.mjs" ? `${endpoint}/v1/traces` : "",
      PINTA_GUARD_ENDPOINT: `${endpoint}/guard/evaluate`,
    };
    const before = payloads.length;
    const first = await run(entry, env);
    assert.equal(first.stdout, "");
    assert.equal(first.stderr, "");
    assert.equal(payloads.length, before + 1);
    assertPayload(expected);
    const cacheFile = path.join(data, "claude-version.json");
    const cache = fs.readFileSync(cacheFile, "utf8");
    assert.equal(JSON.parse(cache)[0].version, expected);

    const second = await run(entry, env, "PostToolUse");
    assert.equal(second.stderr, "");
    assert.equal(payloads.length, before + 2);
    assertPayload(expected);
    assert.equal(fs.readFileSync(cacheFile, "utf8"), cache, "a fresh hook process must reuse the native cache");

    timeline.length = 0;
    const denied = await run(entry, env, "PreToolUse");
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.equal(denied.stderr, "");
    assert.equal(payloads.length, before + 3);
    assertPayload(expected);
    assert.ok(timeline.indexOf("deny") < timeline.indexOf("trace"), "DENY must precede telemetry");

    const disabledData = path.join(root, `disabled-${entry}`);
    const disabled = await run(entry, {
      ...env,
      CLAUDE_PLUGIN_DATA: disabledData,
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
    });
    assert.equal(disabled.stdout, "");
    assert.equal(disabled.stderr, "");
    assert.equal(payloads.length, before + 3);
    assert.equal(fs.existsSync(disabledData), false);

    timeline.length = 0;
    const unavailable = await run(entry, {
      ...env,
      CLAUDE_CODE_EXECPATH: process.execPath,
      CLAUDE_PLUGIN_DATA: path.join(root, `unavailable-${entry}`),
    }, "PreToolUse");
    assert.equal(JSON.parse(unavailable.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.match(unavailable.stderr, /did not identify Claude Code/);
    assert.equal(payloads.length, before + 4);
    assertPayload("unknown");
    assert.ok(timeline.indexOf("deny") < timeline.indexOf("trace"), "failed version discovery must not override DENY");
  }
  if (!external) {
    assert.equal(fs.readFileSync(countFile, "utf8").length, 2, "only one probe per bundle's plugin data, not one per hook");
  }
  console.log(`[smoke:version] OK: CJS + ESM sent service.version=${expected}, SDK=${sdkVersion}; cross-process cache, DENY on discovery failure and disabled telemetry preserved`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
