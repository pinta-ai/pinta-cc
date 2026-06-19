import type { BaseEvent } from "./types.js";
import { type GuardResult, type OtlpPayload } from "@pinta-ai/core";
export declare function buildOtlpPayload(args: {
    event: BaseEvent;
    traceId: string;
    now?: number;
    guard?: GuardResult | null;
}): OtlpPayload;
