// The text Claude Code hands the model for a tool result, recovered from the
// `tool_response` a PostToolUse hook receives.
//
// Claude Code's built-in tools each return their own result shape, and the
// `updatedToolOutput` replacement channel takes one string. When the guard
// masks an output (PTA-695) the hook has to put the masked *text* back, so this
// is the one place that decides which part of the response was the text.
//
// Shapes seen from the built-in tools (Claude Code 2.1.x):
//   - Bash                    -> { stdout, stderr, interrupted, ... }
//   - Read                    -> { type: "text", file: { filePath, content, ... } }
//   - MCP / content-block     -> { content: [{ type: "text", text }, ...] }
//   - Grep / Glob / WebFetch  -> plain string
// Anything else is stringified as JSON, so a value the guard matched inside an
// unknown shape is still present (in escaped form) for the masker to find.
export function returnedText(tool_response: unknown): string {
  if (typeof tool_response === "string") return tool_response;
  if (tool_response === null || tool_response === undefined) return "";
  if (typeof tool_response !== "object") return String(tool_response);

  const response = tool_response as Record<string, unknown>;

  if (typeof response.stdout === "string") {
    const stderr = typeof response.stderr === "string" ? response.stderr : "";
    return stderr ? `${response.stdout}\n${stderr}` : response.stdout;
  }

  const file = response.file;
  if (file && typeof file === "object" && typeof (file as Record<string, unknown>).content === "string") {
    return (file as Record<string, unknown>).content as string;
  }

  if (Array.isArray(response.content)) {
    const texts = response.content
      .filter((block): block is { type: "text"; text: string } =>
        !!block && typeof block === "object"
        && (block as Record<string, unknown>).type === "text"
        && typeof (block as Record<string, unknown>).text === "string")
      .map((block) => block.text);
    if (texts.length > 0) return texts.join("\n");
  }

  return JSON.stringify(tool_response);
}
