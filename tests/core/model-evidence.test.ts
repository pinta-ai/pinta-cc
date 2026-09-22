import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  modelName, readTranscript, TRANSCRIPT_PREFIX_BYTES, TRANSCRIPT_TAIL_BYTES,
} from "../../src/core/model-evidence";

let directory: string;
let file: string;
beforeEach(() => {
  directory = path.resolve(".model-tests", randomUUID());
  fs.mkdirSync(directory, { recursive: true });
  file = path.join(directory, "records.jsonl");
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("bounded model evidence reader", () => {
  it.each([
    null, false, 123, [], {}, { arbitrary: "model" }, { id: "unknown", name: "Display name" }, "auto", "default",
    '{"id":"model"}', ' ["model"] ', "[]", "[object Object]", { id: '{"name":"model"}' },
  ])(
    "does not stringify or guess %j", (input) => expect(modelName(input)).toBeUndefined(),
  );

  it("accepts explicit ID/name descriptors and keeps the host's exact spelling", () => {
    expect(modelName({ id: " Vendor/Exact-Model ", name: "Display name" })).toBe("Vendor/Exact-Model");
    expect(modelName({ name: "exact-model" })).toBe("exact-model");
    expect(modelName("x".repeat(513))).toBeUndefined();
    expect(modelName("model\u0000other")).toBeUndefined();
  });

  it.each([undefined, "", "relative.jsonl", "https://example.com/session.jsonl", 42, "/invalid\u0000.jsonl", "/invalid.txt"])(
    "does not open an invalid path %j", (input) => {
      const open = vi.spyOn(fs, "openSync");
      expect(readTranscript(input)).toBeUndefined();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("reads a read-only file without changing it", () => {
    const original = '{"one":1}\n{"two":2}\n';
    fs.writeFileSync(file, original, { mode: 0o400 });
    const open = vi.spyOn(fs, "openSync");
    expect(readTranscript(file)).toEqual({ first: { one: 1 }, rows: [{ one: 1 }, { two: 2 }], complete: true });
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect(Number(open.mock.calls[0][1]) & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
  });

  it("bounds bytes and skips an oversized boundary record, including split UTF-8", () => {
    fs.writeFileSync(file, '{"header":true}\n' + JSON.stringify({ content: "é".repeat(TRANSCRIPT_TAIL_BYTES) }) + '\n{"model":"tail-model"}\n');
    const read = vi.spyOn(fs, "readSync");
    const result = readTranscript(file);
    expect(result?.first).toEqual({ header: true });
    expect(result?.rows).toEqual([{ model: "tail-model" }]);
    expect(result?.complete).toBe(false);
    const bytes = read.mock.calls.reduce((sum, call) => sum + Number(call[3]), 0);
    expect(bytes).toBeLessThanOrEqual(TRANSCRIPT_PREFIX_BYTES + TRANSCRIPT_TAIL_BYTES);
    expect(read.mock.calls).toHaveLength(2);
  });

  it("bounds parsed records as well as bytes", () => {
    fs.writeFileSync(file, Array.from({ length: 5000 }, (_, n) => JSON.stringify({ n })).join("\n") + "\n");
    const result = readTranscript(file);
    expect(result?.rows).toHaveLength(4096);
    expect(result?.rows[0]).toEqual({ n: 904 });
    expect(result?.complete).toBe(false);
  });

  it("never treats an uncommitted final line as evidence", () => {
    fs.writeFileSync(file, '{"complete":true}\n{"model":"not-committed"}');
    expect(readTranscript(file)).toEqual({ first: { complete: true }, rows: [{ complete: true }], complete: false });
    fs.writeFileSync(file, '{"model":"not-committed"}');
    expect(readTranscript(file)).toBeUndefined();
  });

  it("fails quietly on malformed, missing, empty, directory and symlink inputs", () => {
    const stderr = vi.spyOn(process.stderr, "write");
    expect(readTranscript(file)).toBeUndefined();
    fs.writeFileSync(file, "");
    expect(readTranscript(file)).toBeUndefined();
    fs.writeFileSync(file, '{"one":1}\nmalformed\n{"two":2}\n');
    expect(readTranscript(file)).toBeUndefined();
    const link = path.join(directory, "link.jsonl");
    fs.symlinkSync(file, link);
    expect(readTranscript(link)).toBeUndefined();
    const subdirectory = path.join(directory, "directory.jsonl");
    fs.mkdirSync(subdirectory);
    expect(readTranscript(subdirectory)).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("does not read non-regular files and always closes the descriptor", () => {
    fs.writeFileSync(file, "{}\n");
    const stat = fs.statSync(file);
    vi.spyOn(fs, "fstatSync").mockReturnValue({ ...stat, isFile: () => false } as fs.Stats);
    const read = vi.spyOn(fs, "readSync");
    const close = vi.spyOn(fs, "closeSync");
    expect(readTranscript(file)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("absorbs permission errors without logging file contents or paths", () => {
    vi.spyOn(fs, "openSync").mockImplementation(() => { throw new Error("private-path-and-content"); });
    const stderr = vi.spyOn(process.stderr, "write");
    expect(readTranscript(file)).toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("rejects a file truncated while the snapshot was read", () => {
    fs.writeFileSync(file, '{"one":1}\n');
    const stat = fs.statSync(file);
    vi.spyOn(fs, "fstatSync").mockReturnValueOnce(stat).mockReturnValueOnce({ ...stat, size: 0 } as fs.Stats);
    const close = vi.spyOn(fs, "closeSync");
    expect(readTranscript(file)).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});
