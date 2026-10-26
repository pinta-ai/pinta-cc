import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(process.argv[2] ?? path.join(repo, "dist"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-credential-smoke-"));
let current;
let checks = 0;
const server = http.createServer(async (request, response) => {
  try {
    let body = "";
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    assert.ok(["/guard/evaluate", "/v1/traces"].includes(request.url));
    current.push({ url: request.url, payload });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ decision: "ALLOW", reason: null, durationMs: 1 }));
  } catch (error) {
    current.error = error;
    response.writeHead(500).end();
  }
});

function attributes(payload) {
  const spans = payload.resourceSpans.flatMap((resource) =>
    resource.scopeSpans.flatMap((scope) => scope.spans));
  assert.equal(spans.length, 1);
  return Object.fromEntries(spans[0].attributes.map((attribute) =>
    [attribute.key, Object.values(attribute.value)[0]]));
}

async function run(entry, hook, code, endpoint) {
  const home = path.join(root, String(checks++));
  fs.mkdirSync(home);
  const tool = {
    tool_name: "mcp__claude-in-chrome__javascript_tool",
    tool_use_id: "synthetic-fetch-call",
    tool_input: { action: "javascript_exec", text: code },
  };
  const event = {
    hook_event_name: hook, session_id: "synthetic-fetch-session",
    cwd: home, transcript_path: path.join(home, "absent-transcript.jsonl"),
    ...(hook === "PostToolBatch"
      ? { tool_calls: [{ ...tool, tool_response: { ok: true } }] }
      : { ...tool, ...(hook === "PostToolUse" ? { tool_response: { ok: true } } : {}) }),
  };
  current = [];
  const child = spawn(process.execPath, [path.join(dist, entry)], {
    cwd: home,
    env: {
      HOME: home, USERPROFILE: home, PATH: "", TMPDIR: home, TMP: home, TEMP: home,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      CLAUDE_PLUGIN_ROOT: home, CLAUDE_PLUGIN_DATA: path.join(home, "data"),
      CLAUDE_CODE_EXECPATH: path.join(home, "not-installed"),
      PINTA_GUARD_ENDPOINT: `${endpoint}/guard/evaluate`,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Native hook timed out: ${entry} ${hook}`));
    }, 15_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code); });
    child.stdin.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.stdin.end(JSON.stringify(event));
  });
  assert.equal(status, 0, stderr);
  assert.equal(stdout, "");
  assert.equal(current.error, undefined);
  const guarded = current.filter((item) => item.url === "/guard/evaluate");
  const relayed = current.filter((item) => item.url === "/v1/traces");
  assert.equal(guarded.length, 1);
  assert.equal(relayed.length, 1);
  assert.equal(attributes(guarded[0].payload)["pinta.credential_matches"], undefined);
  const stored = attributes(relayed[0].payload);
  assert.equal(stored["pinta.guard.decision"], "allow");
  return stored;
}

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  for (const entry of ["index.js", "index.mjs"]) {
    for (const hook of ["PreToolUse", "PostToolUse", "PostToolBatch"]) {
      for (const mode of ["omit", "same-origin", "include"]) {
        const result = await run(entry, hook, `return fetch("/counts", { credentials: "${mode}" });`, endpoint);
        assert.equal(result["pinta.facts"], undefined);
        assert.equal(result["pinta.credential_matches"], undefined);
      }
      for (const code of [
        'const input = { password: "include" }; return input;',
        'return fetch("/counts", { credentials: "FAKE0-nonstandard-value" });',
        'const fetch = custom; return fetch("/counts", { credentials: "include" });',
      ]) {
        const result = await run(entry, hook, code, endpoint);
        const facts = JSON.parse(result["pinta.facts"]);
        assert.ok(facts.items.length > 0, "genuine and unresolved candidates must remain");
        const matches = JSON.parse(result["pinta.credential_matches"]);
        assert.equal(matches.coordinateSpace, "original_attribute_utf16");
        assert.equal(matches.complete, true);
        assert.ok(matches.items.length > 0);
        if (code.includes("FAKE0-nonstandard-value")) {
          assert.equal(matches.items[0].nonstandardFetchMode, true);
          assert.ok(!JSON.stringify(result).includes("FAKE0-nonstandard-value"));
        }
      }
    }
  }
  console.log(`Verified ${checks} native CJS/ESM credential hook cases; isolated manager responses are ALLOW fixtures.`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
