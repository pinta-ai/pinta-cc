import type { PintaConfig } from "../core/config.js";
import type { SessionEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handleSession(
  event: SessionEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config);
  return 0;
}
