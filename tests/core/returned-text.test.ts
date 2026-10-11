import { describe, expect, it } from "vitest";
import { returnedText } from "../../src/core/returned-text.js";

describe("returnedText — the model-facing text of a native tool_response", () => {
  it("returns a string response as is", () => {
    expect(returnedText("plain result")).toBe("plain result");
    expect(returnedText("")).toBe("");
  });

  it("joins Bash stdout and stderr, omitting an empty stderr", () => {
    expect(returnedText({ stdout: "out", stderr: "err", interrupted: false })).toBe("out\nerr");
    expect(returnedText({ stdout: "out", stderr: "", interrupted: false })).toBe("out");
    expect(returnedText({ stdout: "", stderr: "only err" })).toBe("\nonly err");
  });

  it("returns the Read tool's file content", () => {
    expect(returnedText({
      type: "text",
      file: { filePath: "/x/notes.txt", content: "line 1\nline 2", numLines: 2, startLine: 1, totalLines: 2 },
    })).toBe("line 1\nline 2");
  });

  it("joins text content blocks and ignores non-text blocks", () => {
    expect(returnedText({
      content: [
        { type: "text", text: "first" },
        { type: "image", source: { data: "AAAA" } },
        { type: "text", text: "second" },
      ],
    })).toBe("first\nsecond");
  });

  it("falls back to JSON for unknown shapes so matched values stay findable", () => {
    expect(returnedText({ result: "value", nested: { k: 1 } })).toBe('{"result":"value","nested":{"k":1}}');
    expect(returnedText({ content: [{ type: "image" }] })).toBe('{"content":[{"type":"image"}]}');
    expect(returnedText([1, 2])).toBe("[1,2]");
  });

  it("stringifies primitives and treats null/undefined as empty", () => {
    expect(returnedText(42)).toBe("42");
    expect(returnedText(true)).toBe("true");
    expect(returnedText(null)).toBe("");
    expect(returnedText(undefined)).toBe("");
  });
});
