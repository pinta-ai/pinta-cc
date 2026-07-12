// cc-specific binding over the shared guard in @pinta-ai/core. Preserves the
// historical cc behavior: 10s timeout, relay token + disable flag read from
// process.env, and a `pinta-cc/<version>` User-Agent.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
import type { GuardInput, GuardResult } from "@pinta-ai/core";

export type { GuardInput, GuardResult } from "@pinta-ai/core";

const TIMEOUT_MS = 10_000;
// Keep in sync with package.json. The manager parses `pinta-cc/<version>`.
const GUARD_UA = "pinta-cc/1.6.0";

export function evaluateGuard(
  input: GuardInput,
  endpoint: string | undefined,
): Promise<GuardResult | null> {
  return coreEvaluateGuard(input, endpoint, {
    timeoutMs: TIMEOUT_MS,
    token: process.env.PINTA_RELAY_TOKEN ?? "",
    disabled: process.env.PINTA_GUARD_DISABLED === "1",
    userAgent: GUARD_UA,
  });
}
