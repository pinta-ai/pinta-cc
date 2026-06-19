import type { PintaConfig } from "../core/config.js";
import type { PostToolUseEvent, PostToolUseFailureEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handlePostToolUse(
  event: PostToolUseEvent | PostToolUseFailureEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config);
  return 0;
}
