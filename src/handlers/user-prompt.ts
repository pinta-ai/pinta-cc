import type { PintaConfig } from "../core/config.js";
import type { UserPromptSubmitEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handleUserPrompt(
  event: UserPromptSubmitEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config, { traceMode: "new" }); // NEW trace per user turn
  return 0;
}
