import type { BaseEvent } from "./types.js";
import { mergeBatch, type GuardResult, type OtlpAttribute, type OtlpPayload } from "@pinta-ai/core";
export { mergeBatch };
export type { OtlpPayload, OtlpAttribute };
export declare function buildOtlpPayload(args: {
    event: BaseEvent;
    traceId: string;
    now?: number;
    guard?: GuardResult | null;
}): OtlpPayload;
