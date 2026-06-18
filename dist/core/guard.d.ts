import type { GuardInput, GuardResult } from "@pinta-ai/core";
export type { GuardInput, GuardResult } from "@pinta-ai/core";
export declare function evaluateGuard(input: GuardInput, endpoint: string | undefined): Promise<GuardResult | null>;
