import type { PintaConfig } from "../core/config.js";
import type { SubagentEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handleSubagent(
  event: SubagentEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config);
  return 0;
}
