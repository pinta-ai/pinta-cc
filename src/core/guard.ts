// cc-specific binding over the shared guard in @pinta-ai/core. Preserves the
// historical cc behavior: 10s timeout, relay token + disable flag read from
// process.env, and a `pinta-cc/<version>` User-Agent.
//
// Since core 0.8.0 the guard is asked about the OTLP payload the hook is about
// to relay — the same object, built first — rather than a hand-assembled
// summary of the event. The manager projects that span through the AgentEvent
// assembly its relay and the backend already use, so the verdict a hook gets is
// the verdict the stored event would get. See `handlers/pre-tool-use.ts`.
import { evaluateGuard as coreEvaluateGuard } from "@pinta-ai/core";
import type { GuardPayload, GuardResult } from "@pinta-ai/core";

export type { GuardPayload, GuardResult } from "@pinta-ai/core";

const TIMEOUT_MS = 10_000;
// Keep in sync with package.json. The manager parses `pinta-cc/<version>`.
const GUARD_UA = "pinta-cc/1.9.0";

export function evaluateGuard(
  payload: GuardPayload,
  endpoint: string | undefined,
): Promise<GuardResult | null> {
  return coreEvaluateGuard(payload, endpoint, {
    timeoutMs: TIMEOUT_MS,
    token: process.env.PINTA_RELAY_TOKEN ?? "",
    disabled: process.env.PINTA_GUARD_DISABLED === "1",
    userAgent: GUARD_UA,
  });
}
