import path from "path";
import { envOptionsResolver } from "@pinta-ai/core";

/**
 * Plugin config — ONLY the bits we actually use after v1.2.
 * Endpoint/headers come from OTEL_EXPORTER_OTLP_* env vars (set by
 * env-bridge.ts at process startup) — they are NOT in this struct.
 */
export interface PintaConfig {
  pluginRoot: string;
  pluginData: string;
  tracePath: string;
}

export function loadConfig(): PintaConfig {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || process.cwd();
  const pluginData =
    process.env.CLAUDE_PLUGIN_DATA || path.join(pluginRoot, ".plugin-data");
  return {
    pluginRoot,
    pluginData,
    tracePath: path.join(pluginData, "trace.json"),
  };
}

/** Returns true if OTel endpoint is configured (signal to silently disable telemetry). */
export function hasOtlpEndpoint(): boolean {
  return envOptionsResolver() !== null;
}
