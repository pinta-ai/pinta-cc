import type { PintaConfig } from "../core/config.js";
import type { PermissionEvent } from "../core/types.js";
import { emitEvent } from "./shared.js";

export async function handlePermission(
  event: PermissionEvent,
  config: PintaConfig,
): Promise<number> {
  await emitEvent(event, config);
  return 0;
}
