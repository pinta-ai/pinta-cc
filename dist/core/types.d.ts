export interface BaseEvent {
    session_id: string;
    transcript_path: string;
    cwd: string;
    permission_mode?: string;
    hook_event_name: string;
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
export declare function isPreToolUseEvent(event: BaseEvent): event is PreToolUseEvent;
export declare function isPostToolUseEvent(event: BaseEvent): event is PostToolUseEvent | PostToolUseFailureEvent;
export declare function isUserPromptSubmitEvent(event: BaseEvent): event is UserPromptSubmitEvent;
export declare function isSessionEvent(event: BaseEvent): event is SessionEvent;
export declare function isSubagentEvent(event: BaseEvent): event is SubagentEvent;
export declare function isStopEvent(event: BaseEvent): event is StopEvent;
export declare function isPermissionEvent(event: BaseEvent): event is PermissionEvent;
export declare function isSkippedHook(event: BaseEvent): boolean;
