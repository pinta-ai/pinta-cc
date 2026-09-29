import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildPayload, DiskRetryQueue, MAX_POST_BYTES } from "@pinta-ai/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PintaConfig } from "../../src/core/config.js";
import { deferPayload } from "../../src/handlers/shared.js";

function payload() {
  return buildPayload({
    traceId: "01HQXM7Y9YZJ8MK7Z6P3X1V8R0",
    spanName: "cc.post_tool_use",
    attributes: [{ key: "cc.tool_response", value: { stringValue: "[REDACTED:bearer_token]" } }],
    resource: [],
    scope: { name: "pinta-cc", version: "0.0.0" },
  });
}

describe("deferPayload", () => {
  let directory: string;
  let config: PintaConfig;
  let errors: string[];

  beforeEach(() => {
    directory = path.resolve(".validation", `defer-payload-${randomUUID()}`);
    config = {
      pluginRoot: directory,
      pluginData: path.join(directory, "data"),
      tracePath: path.join(directory, "data", "trace.json"),
    };
    errors = [];
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://127.0.0.1:5147/v1/traces");
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("persists the original payload in the existing core queue format without network IO", () => {
    const original = payload();
    deferPayload(original, config);

    const file = path.join(config.pluginData, "failed-spans.jsonl");
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(entry).toEqual({ savedAt: expect.any(String), payload: original });
    expect(new DiskRetryQueue(config.pluginData, "pinta-cc").readAll()).toEqual([entry]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not create local evidence when telemetry is disabled", () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");

    deferPayload(payload(), config);

    expect(fs.existsSync(config.pluginData)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not append to or flush an existing queue when telemetry is disabled", () => {
    const queue = new DiskRetryQueue(config.pluginData, "pinta-cc");
    queue.enqueue(payload());
    const pending = queue.readAll();
    vi.stubEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "");

    deferPayload(payload(), config);

    expect(queue.readAll()).toEqual(pending);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([0, 1])("preserves the transport byte budget at MAX_POST_BYTES + %i", (excess) => {
    const original = payload();
    const content = { stringValue: "" };
    original.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({ key: "fixture", value: content });
    content.stringValue = "x".repeat(MAX_POST_BYTES - Buffer.byteLength(JSON.stringify(original), "utf-8") + excess);
    expect(Buffer.byteLength(JSON.stringify(original), "utf-8")).toBe(MAX_POST_BYTES + excess);

    deferPayload(original, config);

    const pending = new DiskRetryQueue(config.pluginData, "pinta-cc").readAll();
    if (excess === 0) {
      expect(pending.map((entry) => entry.payload)).toEqual([original]);
      expect(errors).toEqual([]);
    } else {
      expect(pending).toEqual([]);
      expect(fs.existsSync(config.pluginData)).toBe(false);
      expect(errors.join("")).toContain("dropping oversized span payload");
      expect(errors.join("")).toContain("undeliverable, not queued");
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses the existing 1000-entry cap and oldest-entry eviction diagnostic", () => {
    fs.mkdirSync(config.pluginData, { recursive: true });
    const original = payload();
    const entries = Array.from({ length: 1000 }, (_, index) => ({
      savedAt: new Date(index).toISOString(),
      payload: original,
    }));
    fs.writeFileSync(path.join(config.pluginData, "failed-spans.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const latest = payload();

    deferPayload(latest, config);

    const pending = new DiskRetryQueue(config.pluginData, "pinta-cc").readAll();
    expect(pending).toHaveLength(1000);
    expect(pending[0]).toEqual(entries[1]);
    expect(pending.at(-1)?.payload).toEqual(latest);
    expect(errors.join("")).toContain("[pinta-cc] retry-queue full, dropping 1 oldest entries");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
