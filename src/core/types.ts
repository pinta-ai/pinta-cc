// --- Claude Code hook event types ---

export interface BaseEvent {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: string;
  // Other hook-specific fields are accessed via flattening; we don't enumerate them.
  [key: string]: unknown;
}

export interface PreToolUseEvent extends BaseEvent {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseEvent extends BaseEvent {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
}

export interface PostToolUseFailureEvent extends BaseEvent {
  hook_event_name: "PostToolUseFailure";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  error?: string;
  is_interrupt?: boolean;
}

export interface UserPromptSubmitEvent extends BaseEvent {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

export interface SessionEvent extends BaseEvent {
  hook_event_name: "SessionStart" | "SessionEnd";
}

export interface SubagentEvent extends BaseEvent {
  hook_event_name: "SubagentStart" | "SubagentStop";
  agent_id?: string;
  agent_type?: string;
}

export interface StopEvent extends BaseEvent {
  hook_event_name: "Stop";
  stop_hook_active?: boolean;
}

export interface PermissionEvent extends BaseEvent {
  hook_event_name: "PermissionRequest" | "PermissionDenied";
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

// --- Type guards ---

export function isPreToolUseEvent(event: BaseEvent): event is PreToolUseEvent {
  return event.hook_event_name === "PreToolUse";
}

export function isPostToolUseEvent(
  event: BaseEvent,
): event is PostToolUseEvent | PostToolUseFailureEvent {
  return (
    event.hook_event_name === "PostToolUse" || event.hook_event_name === "PostToolUseFailure"
  );
}

export function isUserPromptSubmitEvent(event: BaseEvent): event is UserPromptSubmitEvent {
  return event.hook_event_name === "UserPromptSubmit";
}

export function isSessionEvent(event: BaseEvent): event is SessionEvent {
  return event.hook_event_name === "SessionStart" || event.hook_event_name === "SessionEnd";
}

export function isSubagentEvent(event: BaseEvent): event is SubagentEvent {
  return event.hook_event_name === "SubagentStart" || event.hook_event_name === "SubagentStop";
}

export function isStopEvent(event: BaseEvent): event is StopEvent {
  return event.hook_event_name === "Stop";
}

export function isPermissionEvent(event: BaseEvent): event is PermissionEvent {
  return (
    event.hook_event_name === "PermissionRequest" || event.hook_event_name === "PermissionDenied"
  );
}

// --- Skip-list (route to default no-op handler) ---

const SKIP_HOOKS = new Set(["Notification", "TaskCreated", "TaskCompleted"]);
export function isSkippedHook(event: BaseEvent): boolean {
  return SKIP_HOOKS.has(event.hook_event_name);
}
