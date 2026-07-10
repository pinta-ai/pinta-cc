// cc-specific binding over the shared DiskTransport in @pinta-ai/core. Keeps the
// `new Transport(config)` call shape used by the handlers. Endpoint/headers are
// resolved from the standard OTEL_EXPORTER_OTLP_* env vars (the shared
// envOptionsResolver default), which env-bridge.ts populates at startup.
import { DiskTransport } from "@pinta-ai/core";
import type { PintaConfig } from "./config.js";

export class Transport extends DiskTransport {
  constructor(config: PintaConfig) {
    super({ pluginData: config.pluginData, logPrefix: "pinta-cc" });
  }
}
