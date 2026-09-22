import path from "node:path";
import type { BaseEvent } from "./types.js";
import {
  consensus, eventTime, identifier, modelName, readTranscript, record,
  timestamp, type ModelEvidence,
} from "./model-evidence.js";

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"]);

function transcriptAgent(file: string, session: string): string | undefined {
  const parent = path.dirname(file);
  if (path.basename(parent) !== "subagents" || path.basename(path.dirname(parent)) !== session) return undefined;
  const match = /^agent-(.+)\.jsonl$/.exec(path.basename(file));
  return identifier(match?.[1]);
}

/** A tool is attributed to its requesting assistant, never the latest assistant. */
export function resolveModel(event: BaseEvent, now: number): ModelEvidence | undefined {
  const explicit = modelName(event.model);
  if (explicit) return { name: explicit, source: "hook.model" };
  try {
    return fromTranscript(event, now);
  } catch {
    return undefined;
  }
}

function fromTranscript(event: BaseEvent, now: number): ModelEvidence | undefined {
  if (!TOOL_EVENTS.has(event.hook_event_name)) return undefined;
  const session = identifier(event.session_id);
  const tool = identifier(event.tool_use_id);
  const at = eventTime(event, now);
  if (!session || !tool || at === undefined || typeof event.transcript_path !== "string") return undefined;
  const inPath = transcriptAgent(event.transcript_path, session);
  const agent = event.agent_id === undefined ? inPath : identifier(event.agent_id);
  if ((event.agent_id !== undefined && !agent) || (inPath !== undefined && inPath !== agent)) return undefined;
  if (!agent && event.agent_type !== undefined) return undefined;
  // A subagent-looking path with no verifiable session binding is not a parent transcript.
  if (path.basename(path.dirname(event.transcript_path)) === "subagents" && !inPath) return undefined;

  const transcript = readTranscript(event.transcript_path);
  if (!transcript) return undefined;
  const candidates: Array<ModelEvidence | undefined> = [];
  for (const row of transcript.rows) {
    const time = timestamp(row.timestamp);
    if (row.type !== "assistant" || row.sessionId !== session || time === undefined || time > at) continue;
    const rowAgent = row.agentId === undefined ? undefined : identifier(row.agentId);
    if (rowAgent !== agent || (row.agentId !== undefined && !rowAgent)
      || (row.isSidechain === true && !agent)) continue;
    const message = record(row.message);
    if (!message || (message.role !== undefined && message.role !== "assistant")
      || !Array.isArray(message.content)
      || !message.content.some((item) => record(item)?.type === "tool_use" && record(item)?.id === tool)) continue;
    const name = modelName(message.model);
    candidates.push(name ? { name, source: "transcript.assistant.message" } : undefined);
  }
  return consensus(candidates);
}
