# pinta-cc — Generic OTLP forwarder for Claude Code hook events

Converts Claude Code hook events into OTLP/HTTP spans and forwards them to any OpenTelemetry-compatible collector. No Pinta CLI dependency. No identity check at plugin time. Vendor-neutral.

## Features

- **OTLP transport**: converts 11 hook event types into OTLP/HTTP `resourceSpans` and sends them via `POST {endpoint}/traces`
- **Bronze flattening**: every top-level field of a hook event is flattened into `cc.<key>` span attributes
- **ULID per-turn traceId**: `UserPromptSubmit` starts a new ULID-based trace; all subsequent hooks in the same turn share it
- **Retry queue**: on transport failure, payloads are appended to `.plugin-data/failed-spans.jsonl` (cap 1000) and flushed on the next hook invocation
- **Vendor-neutral**: any OTel-compatible collector works. Pinta Manager auto-configures the endpoint and token
- **Identity at relay**: `member.identity.*` attributes are no longer attached at plugin time. Pinta Manager (or your own pipeline) attaches identity at the forwarding layer

## Channels

| Channel | Install path | Auto-update |
|---------|-------------|-------------|
| **Pinta Manager v0.2+** | Manager installs and configures automatically | Yes — on manager reconcile |
| **Marketplace `pinta-cc@pinta-ai`** | `/plugin marketplace add pinta-ai/pinta-cc` then `/plugin install pinta-cc@pinta-ai` | Yes — on Claude Code startup |

## Installation

### Pinta Manager (recommended for enterprise)

Pinta Manager v0.2+ handles installation and configuration automatically. No manual steps required.

### Marketplace

```bash
/plugin marketplace add pinta-ai/pinta-cc
/plugin install pinta-cc@pinta-ai
```

After installation, Claude Code automatically pulls new versions from the marketplace on every startup.

### Direct from GitHub

```bash
claude plugin install github:pinta-ai/pinta-cc
```

### Local development

```bash
git clone https://github.com/pinta-ai/pinta-cc.git
cd pinta-cc
npm install && npm run build
claude --plugin-dir .
```

## Configuration

### userConfig (Claude Code plugin settings)

| Setting | Description | Required |
|---------|-------------|----------|
| `endpoint` | OTLP/HTTP traces endpoint. Pinta Manager auto-fills. OSS: any OTel collector URL | Yes |
| `api_key` | Token sent as `x-pinta-relay-token` header. Pinta Manager auto-fills | Conditional |

### Pinta Manager scenario

Pinta Manager v0.2+ injects `CLAUDE_PLUGIN_OPTION_ENDPOINT` and `CLAUDE_PLUGIN_OPTION_API_KEY` automatically via Claude Code's `settings.json`. No manual configuration needed.

### OSS / direct scenario

Set `endpoint` to your OTLP collector URL (e.g. `http://localhost:4318`) and `api_key` to whatever token your collector expects. The token is sent as `x-pinta-relay-token`.

For collectors that need a different auth header, set `OTEL_EXPORTER_OTLP_HEADERS` directly in your environment — this overrides the `api_key` userConfig:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"
```

### OTel env var precedence

The plugin reads OTel env vars directly. `CLAUDE_PLUGIN_OPTION_*` env vars (set by Claude Code from userConfig) are bridged to their `OTEL_EXPORTER_OTLP_*` equivalents **only when the OTel var is not already set**. Explicit `OTEL_EXPORTER_OTLP_*` always win.

| Plugin userConfig | Bridged to |
|------------------|-|
| `CLAUDE_PLUGIN_OPTION_ENDPOINT` | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `CLAUDE_PLUGIN_OPTION_API_KEY` | `OTEL_EXPORTER_OTLP_HEADERS=x-pinta-relay-token=<key>` |

## Span attribute conventions

### Resource attributes

| Attribute | Value |
|-----------|-------|
| `service.name` | `"claude-code"` |
| `service.version` | Claude Code CLI version |
| `telemetry.sdk.name` | `"pinta-cc"` |
| `telemetry.sdk.version` | Plugin version |
| `process.pid` | Hook process PID |
| `process.owner` | OS username |
| `host.name` | Machine hostname |
| `host.arch` | CPU architecture |

Note: `member.identity.*` attributes are **not** attached at plugin time (moved to relay layer).

### Span attributes

| Attribute | Value |
|-----------|-------|
| `ingest.type` | `"cc"` (discriminator for aware-backend parser) |
| `cc.hook` | Hook event name (e.g. `PreToolUse`) |
| `cc.<key>` | All other top-level hook event fields (Bronze flattening) |

## Architecture

```
src/
├── index.ts              # Entry point: env-bridge → stdin parse → handler routing
├── core/
│   ├── env-bridge.ts     # CLAUDE_PLUGIN_OPTION_* → OTEL_EXPORTER_OTLP_* alias
│   ├── types.ts          # Hook event types, type guards, skip-list
│   ├── config.ts         # loadConfig() + hasOtlpEndpoint()
│   ├── otlp.ts           # OTLP payload builder + Bronze flattening + ULID→traceId
│   ├── transport.ts      # POST {endpoint}/traces (5s timeout, reads OTel env at call time)
│   ├── retry-queue.ts    # File-based JSONL queue (cap 1000, 30s stale lock TTL)
│   ├── trace.ts          # traceId management (ULID, file-based sharing)
│   ├── identity.ts       # Empty stub (identity attribution moved to relay)
│   └── redact.ts         # Tier-1 redaction + Tier-3 truncation
└── handlers/
    ├── pre-tool-use.ts   # flush → currentTrace → buildOtlpPayload → send → exit 0
    ├── post-tool-use.ts
    ├── user-prompt.ts    # flush → newTrace → buildOtlpPayload → send → exit 0
    ├── session.ts
    ├── subagent.ts
    ├── stop.ts
    ├── permission.ts
    └── default.ts        # Notification, TaskCreated, TaskCompleted → exit 0 immediately
```

## Event flow

```
UserPromptSubmit (newTrace() → POST /traces)
  → PreToolUse (currentTrace() → POST /traces)
  → PostToolUse (currentTrace() → POST /traces)
  → ...
UserPromptSubmit (next turn, new traceId)
  → ...
```

Each hook invocation spawns a fresh Node process. One hook = one OTLP span = one `resourceSpans` entry. Retry queue flush batches multiple spans into a single body.

## Captured events (11)

PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart, SessionEnd, PermissionRequest, PermissionDenied, SubagentStart, SubagentStop, Stop

## Skipped events (3, exit 0 immediately)

Notification, TaskCreated, TaskCompleted

## Development

```bash
npm install
npm run build         # tsc → dist/
npm test              # vitest run
npm run mock-server   # Generic OTLP collector at http://localhost:3000
```

### Local integration test

```bash
# Terminal 1: start the mock OTLP collector
npm run mock-server

# Terminal 2: run Claude Code with the plugin
CLAUDE_PLUGIN_OPTION_ENDPOINT=http://localhost:3000 \
CLAUDE_PLUGIN_OPTION_API_KEY=test-token \
claude --plugin-dir .
```

Open `http://localhost:3000` to inspect captured spans.

## BREAKING CHANGES from 1.1.x

| What changed | 1.1.x | 1.2.x | Migration |
|---|---|---|---|
| Pinta CLI dependency | Required (`pinta login`) | Removed | Nothing; Pinta Manager or direct OTel env |
| `endpoint` meaning | Pinta backend URL | Any OTLP collector URL | Update to your collector's `/v1/traces` or equivalent |
| `api_key` meaning | Pinta backend API key (`x-api-key` header) | Relay token (`x-pinta-relay-token` header) | Pinta Manager: automatic. Standalone: update token |
| Identity attributes | `member.identity.id/email` in resource attrs | Removed | Attach at your collector/forwarder layer |
| PreToolUse fail-close | Exit 2 (deny) when identity unresolved | Removed — always exit 0 | No action needed |
| `src/enterprise/` | Present | Removed | No action needed |

**Pinta Manager users:** No action required. Manager v0.2 auto-injects config on next reconcile.

**Marketplace users:** Auto-updated on next Claude Code startup. Update `endpoint` userConfig to your OTLP collector URL if you manage your own pipeline.

**Direct env var users:** Replace `CLAUDE_PLUGIN_OPTION_API_KEY` token semantics and ensure your collector accepts `x-pinta-relay-token`, or set `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>` directly.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — see [LICENSE](LICENSE).

Commercial use is **not permitted** under this license. Noncommercial use (personal projects, research, educational institutions, nonprofits, government) is allowed. For a commercial license, please contact Pinta AI.
