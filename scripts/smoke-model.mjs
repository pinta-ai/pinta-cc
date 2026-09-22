import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";

const prefix = "cc";
const root = path.resolve(".model-smoke-" + randomUUID());
const now = Date.now();
const source = "transcript.assistant.message";
const received = [];
const durations = {};
let requests = 0;
fs.mkdirSync(root, { recursive: true });

function records(session = "session-1", time = now - 1000, agent) {
  return [
    { type: "user", sessionId: session, timestamp: new Date(now - 2000).toISOString() },
    { type: "assistant", sessionId: session, timestamp: new Date(time).toISOString(), ...(agent ? { agentId: agent, isSidechain: true } : {}), message: { role: "assistant", model: "transcript-model", content: [{ type: "tool_use", id: "call-1" }] } },
  ];
}
function transcript(name, rows, committed = true) {
  const file = path.join(root, name + ".jsonl");
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (committed ? "\n" : ""));
  return file;
}
const matching = transcript("matching", records());
const big = records();
big.splice(1, 0, { type: "unrelated", content: "x".repeat(2 * 1024 * 1024) });
const cases = [
  { name: "explicit", event: { model: { id: "host-model", name: "Display name" } }, model: "host-model", source: "hook.model" },
  { name: "missing", event: { transcript_path: path.join(root, "absent.jsonl") } },
  { name: "placeholder", event: { model: "unknown", transcript_path: path.join(root, "absent.jsonl") } },
  { name: "stringified-object", event: { model: '{"id":"not-an-id"}', transcript_path: path.join(root, "absent.jsonl") } },
  { name: "stringified-array", event: { model: '["not-an-id"]', transcript_path: path.join(root, "absent.jsonl") } },
  { name: "host-source", event: { model: " host-model ", model_source: "host.response" }, model: "host-model", source: "host.response" },
  { name: "correlated", event: {}, model: "transcript-model", source },
  { name: "original-source", event: { model: "unknown", model_source: "host.selection" }, model: "transcript-model", source, originalSource: "host.selection" },
  { name: "other-session", event: { transcript_path: transcript("other", records("session-2")) } },
  { name: "future", event: { transcript_path: transcript("future", records("session-1", now + 60_000)) } },
  { name: "no-tool-id", event: { tool_use_id: undefined } },
  { name: "subagent", event: { transcript_path: transcript("child", records("session-1", now - 1000, "child-1")) } },
  { name: "partial", event: { transcript_path: transcript("partial", records(), false) } },
  { name: "bounded-tail", event: { transcript_path: transcript("large", big) }, model: "transcript-model", source },
];

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  received.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
  requests++;
  res.end("{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1/traces`;

async function hook(bundle, sample, expected = sample.model) {
  const home = path.join(root, randomUUID());
  fs.mkdirSync(home);
  const event = {
    hook_event_name: "PostToolUse", session_id: "session-1", timestamp: now,
    transcript_path: matching, tool_use_id: "call-1", tool_name: "Read", tool_input: {}, cwd: home,
    ...sample.event,
  };
  const started = performance.now();
  const child = spawn(process.execPath, [bundle], {
    env: {
      HOME: home, PATH: "", TMPDIR: home, TMP: home, TEMP: home,
      CLAUDE_PLUGIN_ROOT: home, CLAUDE_PLUGIN_DATA: path.join(home, "data"),
      CLAUDE_CODE_EXECPATH: path.join(home, "not-installed"),
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("hook timeout")); }, 15_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (status) => { clearTimeout(timeout); resolve(status); });
    child.stdin.on("error", reject);
    child.stdin.end(JSON.stringify(event));
  });
  const elapsed = performance.now() - started;
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.ok(!stderr.includes("] error:"), stderr);
  assert.equal(received.length, 1, "one OTLP request per hook; no manager/guard request");
  const request = received.shift();
  assert.equal(request.url, "/v1/traces");
  assert.equal(request.authorization, undefined);
  const spans = request.body.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans));
  assert.equal(spans.length, 1);
  const models = spans[0].attributes.filter((attribute) => attribute.key === `${prefix}.model`);
  assert.equal(models.length, expected === undefined ? 0 : 1, sample.name);
  assert.equal(models[0]?.value.stringValue, expected, sample.name);
  if (expected !== undefined) {
    assert.equal(spans[0].attributes.find((attribute) => attribute.key === `${prefix}.model_source`)?.value.stringValue, sample.source);
  }
  if (sample.originalSource) {
    assert.equal(spans[0].attributes.find((attribute) => attribute.key === `${prefix}.model_original_source`)?.value.stringValue, sample.originalSource);
  }
  return elapsed;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3));
}
try {
  for (const entry of ["dist/index.js", "dist/index.mjs"]) {
    for (const sample of cases) {
      const elapsed = await hook(path.resolve(entry), sample);
      (durations[sample.name] ??= []).push(elapsed);
    }
  }
  let comparison;
  const baseline = process.argv.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length);
  if (baseline) {
    const old = [], current = [];
    const sample = cases.find((item) => item.name === "correlated");
    for (let n = 0; n < 12; n++) {
      old.push(await hook(path.resolve(baseline), { ...sample, model: undefined, source: undefined }));
      current.push(await hook(path.resolve("dist/index.js"), sample));
    }
    comparison = { samples: old.length, baselineMedianMs: median(old), currentMedianMs: median(current), medianPairedDeltaMs: median(current.map((ms, i) => ms - old[i])) };
  }
  const result = {
    adapter: prefix, builds: ["cjs", "esm"], casesPerBuild: cases.length, verifiedRequests: requests,
    hookWallMedianMs: Object.fromEntries(Object.entries(durations).map(([name, values]) => [name, median(values)])),
    comparison, note: "Wall times include fresh Node startup and loopback OTLP; paired deltas include scheduler noise.",
  };
  fs.mkdirSync(".validation", { recursive: true });
  fs.writeFileSync(".validation/model-smoke.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
