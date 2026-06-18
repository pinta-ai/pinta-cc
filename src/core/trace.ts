// cc-specific binding over the shared TraceManager in @pinta-ai/core. Keeps the
// `new TraceManager(config)` call shape used by the handlers.
import { TraceManager as CoreTraceManager } from "@pinta-ai/core";
import type { PintaConfig } from "./config.js";

export class TraceManager extends CoreTraceManager {
  constructor(config: PintaConfig) {
    super(config.tracePath);
  }
}
