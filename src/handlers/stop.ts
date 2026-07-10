import type { PintaConfig } from "../core/config.js";
import type { StopEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handleStop(
  event: StopEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config);
  return 0;
}
