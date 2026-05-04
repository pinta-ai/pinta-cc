"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bridgeUserConfigToOtelEnv = bridgeUserConfigToOtelEnv;
/**
 * Bridge Claude Code's userConfig env vars (CLAUDE_PLUGIN_OPTION_*) to the
 * OTel SDK standard env vars (OTEL_EXPORTER_OTLP_*).
 *
 * Claude Code maps each plugin.json `userConfig.<key>` to a corresponding
 * `CLAUDE_PLUGIN_OPTION_<KEY>` env var on hook spawn. We keep the user-
 * facing names friendly (`endpoint`, `api_key`) and translate them into the
 * canonical OTel env names so transport.ts (and any future OTel SDK adoption)
 * can read them via the OTel-spec names.
 *
 * The user-facing `endpoint` is treated as a *full* OTLP/HTTP traces URL
 * (e.g., `http://127.0.0.1:5147/v1/traces`), so we map it to
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (signal-specific full URL per OTel
 * spec) rather than `OTEL_EXPORTER_OTLP_ENDPOINT` (which is a base URL the
 * SDK appends `/v1/traces` to). This way both the OTel SDK (when used) and
 * pinta-cc's hand-written transport agree on the URL without any path
 * manipulation downstream.
 *
 * Pinta Manager auto-injects `CLAUDE_PLUGIN_OPTION_*` via Claude Code's
 * settings.json. OSS users fill them in via the `/plugin install` UI.
 *
 * Existing OTEL_EXPORTER_OTLP_TRACES_ENDPOINT / HEADERS take precedence
 * (explicit override).
 */
function bridgeUserConfigToOtelEnv() {
    if (process.env.CLAUDE_PLUGIN_OPTION_ENDPOINT &&
        !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT =
            process.env.CLAUDE_PLUGIN_OPTION_ENDPOINT;
    }
    if (process.env.CLAUDE_PLUGIN_OPTION_API_KEY && !process.env.OTEL_EXPORTER_OTLP_HEADERS) {
        process.env.OTEL_EXPORTER_OTLP_HEADERS =
            `x-pinta-relay-token=${process.env.CLAUDE_PLUGIN_OPTION_API_KEY}`;
    }
}
//# sourceMappingURL=env-bridge.js.map