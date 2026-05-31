export interface GuardInput {
    spanId: string;
    toolName?: string;
    toolInput?: unknown;
    rawTextFields?: Record<string, string>;
}
export interface GuardResult {
    decision: 'ALLOW' | 'DENY' | 'REVIEW';
    reason: string | null;
    userMessage: string | null;
    durationMs: number;
    failOpenReason?: 'timeout' | 'refused' | 'error';
}
export declare function evaluateGuard(input: GuardInput, endpoint: string | undefined): Promise<GuardResult | null>;
