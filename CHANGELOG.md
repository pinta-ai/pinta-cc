# Changelog

All notable changes to pinta-cc are documented here.

## [1.3.2] - 2026-06-12

### Changed

- Guard request timeout raised from `50ms` to `10s` in `src/core/guard.ts`. The
  previous 50ms window caused PreToolUse guard requests to fail open (`ALLOW`)
  before the manager's `/guard/evaluate` could respond. The endpoint now has
  time to actually evaluate. Fail-open behavior on timeout is unchanged.

## [1.3.1] - 2026-05-31

### Added

- `GuardResult.userMessage` — the PreToolUse guard now reads a pre-formatted
  `userMessage` field from the manager's `/guard/evaluate` response and
  surfaces it as the `permissionDecisionReason` on a DENY. This carries the
  "Blocked by Pinta AI" brand text + rule name straight to the LLM/user.

### Changed

- On a guard DENY, `permissionDecisionReason` now prefers `userMessage`, then
  falls back to the raw `reason`, then to the `'guard_deny'` literal.

### Compatibility

- Forward-compatible. Older managers that don't emit `userMessage` leave the
  field as `null`, and the handler falls back to `reason` exactly as before.

## [1.3.0] - 2026-05-26

### Added

- `src/env-file.ts` — graceful loader for `~/.claude/pinta-cc.env`. The adaptor
  now reads `KEY=VALUE` pairs from that file at startup and merges any
  unset keys into `process.env`. Existing values (shell-exported by the
  user, or injected by an older Pinta Manager's shell prefix) are
  preserved — `process.env[k] ??= envFile[k]`.
- `tests/env-file.test.ts` — covers file-exists, file-missing (silent
  no-op), comment/blank lines, no-overwrite of existing keys, and
  malformed-line tolerance.

### Migration

This is a forward-compatible release. The new loader is paired with Pinta
Manager v0.1.6, which writes `~/.claude/pinta-cc.env` instead of
prefixing the hook `command` with a POSIX shell env assignment
(`KEY='val' node ...`). The shell-prefix form is broken on native
Windows shells (cmd.exe / PowerShell); switching to an env file removes
the shell dependency.

- New adaptor (1.3.0) + new manager (v0.1.6+): env file is read, hook
  command is plain `node <plugin-root>/dist/index.js`.
- New adaptor (1.3.0) + old manager (v0.1.5): env file is missing,
  loader silently no-ops, and the shell prefix's already-injected
  `process.env` values flow through unchanged.

See `docs/features/v0.1.6/cc-env-file.md` in pinta-manager for the
catalog-first rollout plan that this release enables.

## [1.2.0] - 2026-04-29 (BREAKING)

### BREAKING CHANGES

- **Guard module removed** — PreToolUse no longer evaluates server-side block rules. Enforcement is deferred to a future manager-side endpoint.
- **Pinta CLI dependency removed** — `pinta identity id/email` is no longer invoked. Identity attribution moves to the relay layer (Pinta Manager attaches on forward; OSS users handle in their own pipeline).
- **`api_key` semantics changed** — was: Pinta backend API key sent as `x-api-key`. Now: token sent as `x-pinta-relay-token` header (or any header via `OTEL_EXPORTER_OTLP_HEADERS` override).
- **`endpoint` semantics changed** — was: Pinta backend URL. Now: any OTLP/HTTP traces collector URL.
- **PreToolUse fail-close removed** — without identity to check, the deny path no longer fires. All hooks exit 0 on success, 1 on transport-only failures (handled internally — fail-open).
- **`member.identity.*` resource attributes removed** — relay attaches identity if present.
- **`src/enterprise/` directory removed** — `PintaIdentityResolver`, `PintaGuardClient` deleted.
- **`src/handlers/auth-message.ts` removed** — no auth message to print.
- **`src/core/guard.ts` removed**.

### Added

- `src/core/env-bridge.ts` — aliases Claude Code's `CLAUDE_PLUGIN_OPTION_*` env vars to OTel-spec `OTEL_EXPORTER_OTLP_*`. Explicit OTel env vars take precedence over the bridge.
- `vitest` test suite (`tests/core/*.test.ts`) — covers OTLP builder + env-bridge.
- `hasOtlpEndpoint()` helper in `src/core/config.ts` (currently unused — reserved for future signaling).

### Changed

- `buildOtlpPayload` signature: `{event, traceId, identity, now?}` → `{event, traceId, now?}`.
- `Transport` reads OTel env vars at every send/flush call; silent-disables when endpoint missing (was: `loadConfig()` threw).
- `package.json` name: `pinta` → `@pinta-ai/pinta-cc`.
- `.claude-plugin/plugin.json` description and userConfig descriptions updated for OTel collector framing.
- Mock server (`tools/mock-server.ts`) reduced to a generic OTLP collector + viewer (removed Pinta-backend-specific endpoints).

### Migration

**For Pinta Manager users:** No action required. Pinta Manager M9d will auto-inject `CLAUDE_PLUGIN_OPTION_ENDPOINT` and `CLAUDE_PLUGIN_OPTION_API_KEY` via Claude Code's settings.json. Marketplace install picks up 1.2.0 on next Claude Code startup.

**For standalone users:**
1. Update `endpoint` userConfig to your OTLP/HTTP collector URL.
2. Update `api_key` to whatever token your collector expects (will be sent as `x-pinta-relay-token`).
3. For non-Pinta collectors needing different auth headers, set `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>` directly in the environment — this overrides the userConfig-based bridge.

**Identity attribution:** v1.1's `member.identity.*` resource attrs are gone. If you depended on them in your pipeline, attach them at your collector / forwarder layer.
