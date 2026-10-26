# Changelog

All notable changes to pinta-cc are documented here.

## [1.11.4-pta843.1] - 2026-10-26

### Fixed

- Include the bundled Acorn parser's complete MIT notice in npm and Git
  distributions; the native credential smoke check also verifies this file.
- Supersede the initial prerelease without changing its immutable archive.
  Manager catalog selection continues to prefer eligible stable adaptors;
  publishing a prerelease is not an automatic installed-device rollout.

## [1.11.4-pta843.0] - 2026-10-26

### Changed

- Pin Core `0.11.1-pta843.0`: supported direct Fetch `credentials` mode options
  no longer become stored credential-field candidates. Shadowed/unknown
  consumers, nonstandard values and actual passwords remain protected.
- Stored telemetry retains value-free pattern/original-attribute ranges and
  pre-mask nonstandard-mode counterevidence. It never reports those ranges as
  offsets into masked text; the guard representation and batch response policy
  remain unchanged.
- Stage-only prerelease distribution is separate from Marketplace
  `main`, npm `latest`, and `skax`. Native CJS/ESM regressions cover all three
  affected hooks.

## [1.11.3] - 2026-10-19

### Changed

- `@pinta-ai/core` 0.11.0 (PTA-735). 16,384바이트 이상 긴 입력은 guard 판정을 최대 3초 기다린다(요청 쪽만, 짧은 입력은 그대로). 이전에는 긴 명령의 판정이 마감에 걸려 판정 없이 통과할 수 있었다. 서버로 보낼 사본만 새 모양까지 가리고, guard 가 판정할 사본은 그대로 둔다.

## [1.11.2] - 2026-10-12

### Changed

- `PostToolBatch` DENY never produces a native response. 1.11.1 still answered
  `decision: "block"` on an explicit manager `outputAction: "withhold"`
  (prompt injection), which Claude Code treats as a run stop
  (`PostToolBatch hook stopped continuation`, measured on 2.1.286 and 2.1.296)
  and so cost the user a turn on every injection false positive. The batch only
  re-judges results `PostToolUse` already handled, so the hook now stays silent
  on every batch verdict: the model keeps the per-tool notice and guidance, the
  turn continues, and the batch DENY evidence is still deferred (PTA-695).

### Compatibility

- No manager, policy, timeout or dependency change. Denied tool outputs on
  Claude Code are now never a turn stop; containment rests on the
  `PostToolUse` response and the `PreToolUse` guard.

## [1.11.1] - 2026-10-12

### Changed

- `PostToolBatch` DENY blocks only on an explicit manager
  `outputAction: "withhold"`. Claude Code treats a batch `decision: "block"`
  as a run stop ("hook stopped continuation", measured on 2.1.286), and the
  batch re-judges results `PostToolUse` already handled, so a mask advice or
  a manager that sends no `outputAction` now produces no native response; the
  DENY evidence is still deferred (PTA-695).
- Claude Code-specific mask guidance in `additionalContext`. Claude Code
  2.1.286 and 2.1.296 were measured to ignore `updatedToolOutput` for built-in
  tools, so the hint no longer claims the output was masked: it names the
  finding and tells the model to treat the values as sensitive and continue
  without them. `updatedToolOutput` is still emitted for a host that applies
  it.

### Compatibility

- No manager, policy, timeout or dependency change. Manager < 0.1.16 (no
  `outputAction`) no longer stops the turn on a batch DENY; its output DENYs
  still withhold with the policy message.

## [1.11.0] - 2026-10-11

### Changed

- An output `DENY` at `PostToolUse` no longer stops the session. The hook now
  replaces the denied result and hands the model the policy's own message
  (the manager's `userMessage`, plus `evaluationId` when sent) with a fixed
  recovery hint, instead of the former fixed `continue: false` /
  "Start a new session" stop (PTA-695).
- **Mask**: when the manager answers `outputAction: "mask"` with the detected
  values, the original output is delivered through Claude Code's
  `hookSpecificOutput.updatedToolOutput` with only those values replaced by
  `[REDACTED:<category>]`; the notice and guidance ride in `additionalContext`
  and the turn continues.
- **Withhold**: otherwise the result is replaced by
  `[Pinta withheld this tool output — <notice>]` behind `decision: "block"`,
  with the notice as `reason` and the withhold guidance as `additionalContext`.
- `PostToolBatch` DENY emits `{"decision":"block","reason":<notice>}` only;
  the batch has no replacement channel and ignores mask advice.
- Masked text is cut at 9,900 characters with a visible
  ` …[truncated by Pinta: <n> more characters]` marker so the final
  `updatedToolOutput` stays within Claude Code's 10,000-character cap.
- The model-facing text is recovered from the native `tool_response` shape
  (`stdout`+`stderr`, `file.content`, `content[].text`, string, else JSON).
- Bundle `@pinta-ai/core` `^0.10.0` (`buildOutputDenial`, `GuardResult`
  `evaluationId` / `outputAction` / `redactions`). Guard User-Agent
  `pinta-cc/1.11.0`.

### Compatibility

- Manager < 0.1.16 (no `outputAction`) → every output DENY withholds, with the
  policy `userMessage` as the notice. No manager change is required to keep
  denying; masking needs manager 0.1.16+.
- `updatedToolOutput` requires Claude Code ≥ 2.1.265 and applies to built-in
  tools only (10,000-character cap). Older hosts ignore it: a withhold still
  blocks via `decision: "block"`; a mask then leaves the original result as is.
- Unchanged: exactly one stdout JSON line written before any telemetry,
  `pinta.guard.target = "tool_output"`, decided DENYs persist the original
  redacted span locally without collector IO, exit 0, `PreToolUse` /
  `PermissionRequest` responses, ALLOW/REVIEW/fail-open paths. The manager's
  `redactions` are never copied onto the span, the retry queue or stderr.

## [1.10.2] - 2026-09-30

### Fixed

- Bundle `@pinta-ai/core` `^0.9.2`, preserving ordinary `find -path` and
  `find -print` arguments while retaining mysql-family short-password
  masking (PTA-515). Guard/export ordering is unchanged.
- Evaluate `PermissionRequest` and emit its native deny decision before local
  telemetry deferral. ALLOW/REVIEW do not grant permission; `PermissionDenied`
  remains observation-only (PTA-583).
- Register and guard `PostToolBatch` using its original model-facing results,
  including failed calls, and stop denied batches before the next model request.
  Native Claude 2.1.267 ignores a run-stop on `PostToolUseFailure` itself, so
  merely guarding that event would not protect the model (PTA-582).
- Cover both gates in CJS/ESM process regressions, including REVIEW/disabled,
  one-second completion despite delayed collector ACK, and original-span queueing.

### Compatibility

- Batch protection requires synchronous `PostToolBatch` registration and a
  guard/Manager projecting `cc.tool_calls` as output. Managed registration must
  be updated alongside the adapter. Hosts without this event remain unsupported
  for failed-result protection; 2.1.267 is verified, not a minimum-version claim.
- The existing successful-output gate, observation-only failure event, output
  target metadata, bounded retry queue, and guard fail-open behavior remain.
  A batch is a separate native event and can re-evaluate successful output.

## [1.10.1] - 2026-09-29

### Fixed

- Publish the output-enforcement fix above both 1.10.0 and 1.9.1 so semantic
  version selection chooses the fixed adapter.

### Compatibility

- Version-only forward release of the merged behavior shipped in 1.9.1:
  retains the 1.10.0 timeout declaration, native output denial and deferred
  DENY telemetry. No policy, timeout, dependency or hook behavior changes.

## [1.9.1] - 2026-09-29

### Fixed

- Evaluate successful `PostToolUse` output, including native `tool_response`,
  using the original redaction-aware OTLP payload. Previously these events
  emitted telemetry without asking the guard.
- On an output `DENY`, emit Claude Code's supported `continue: false` stop JSON
  before best-effort local persistence, using a fixed message that asks for a new
  session and never reflects untrusted output or guard messages.
- Finish both `PreToolUse` and `PostToolUse` DENYs without collector network IO,
  deferring their original spans through the existing `DiskRetryQueue`. Merely
  printing the response before awaiting telemetry was insufficient: a host
  timeout could discard the decision while waiting for a slow collector.
- Preserve original masked input/output evidence and span identity; attach
  normal guard metadata plus `pinta.guard.target = "tool_output"` for every
  non-null after-tool verdict.
- Add native-output handler regressions and built CJS/ESM stdin/loopback checks
  to PR validation, including a 1-second hook deadline with a 4-second collector
  ACK, queue failure diagnostics, later-hook flush and non-gating boundaries.

### Compatibility

- This stops the current run on hosts honoring Claude Code's documented
  synchronous `PostToolUse` stop contract. It does not undo an executed tool,
  strip retained transcript content or make a resumed conversation safe.
  Start a new session after an output denial; no persistent session lock or
  automatic context clearing is introduced.
- `PreToolUse` permission decisions, permission/lifecycle/internal hooks,
  failed-tool telemetry, ALLOW/REVIEW and existing fail-open behavior remain
  unchanged. No policy thresholds or required guard request fields change.
- This out-of-order patch retains the already-released `@pinta-ai/core` 0.9.0
  timeout-declaration behavior from 1.10.0.
- With telemetry enabled, decided-DENY evidence persists in the existing local
  retry queue; backend visibility waits for a later eligible hook to flush it.
  Guard-only/telemetry-disabled mode does not retain new local evidence.
  Existing size/retention limits and disk-failure diagnostics still apply.

## [1.10.0] - 2026-09-30

### Added

- The guard call declares its 10s timeout to the manager as
  `x-pinta-guard-budget-ms` (via `@pinta-ai/core` 0.9.0). Manager 0.1.10+
  bounds its own work — the backend package check in particular — by 80% of
  the caller's timeout, and until now read cc's from a table of adaptor
  timeouts copied into the manager repo. The number now lives only in
  `src/core/guard.ts` (PTA-579).

### Compatibility

- No behavior change: the timeout stays 10_000ms, which is also what the
  manager's table assumed for pinta-cc. Managers older than 0.1.10 ignore the
  header.
- Still requires Pinta Manager 0.1.11 or later. `@pinta-ai/core` `^0.8.0` →
  `^0.9.0` (bundled).

## [1.9.0] - 2026-09-22

### Added

- Truthful scalar `cc.model` IDs from explicit hook metadata, with source
  preservation and omission of placeholders or stringified objects/arrays.
- Bounded, read-only assistant transcript lookup tied to the exact session,
  tool-use ID, timestamp and subagent. Missing or uncorrelated evidence stays
  absent; a SessionStart selection is never cached onto later tool hooks.
- CJS/ESM model and SDK-version wire checks in the Node 18/20/22 CI matrix.

### Compatibility

- Still requires Pinta Manager 0.1.11 or later. Guard payloads, denial ordering,
  event counts and redaction are unchanged; bundled `@pinta-ai/core` remains
  `^0.8.0`. No new required envelope fields.
- Host-selected models are not independently verified provider routing.

## [1.8.0] - 2026-09-20

### Changed

- The guard is asked about the span, not about a summary of it. Until now the
  `PreToolUse` gate assembled a five-field `GuardInput` (tool name, input, working
  directory, hook, session) beside the span that carried the same facts under
  `cc.*`, and the two were free to drift — `cwd` (PTA-176) and the hook name
  (PTA-207) were on the span and missing from the summary. Now the span is built
  first, `POST /guard/evaluate` receives that OTLP payload unwrapped, the manager
  projects it through the same AgentEvent assembly the backend stores it with,
  and the verdict is attached to the same object before it is relayed — the span
  the manager judged is the span the backend stores, `spanId` included.
  Requires Pinta Manager 0.1.11 or later; an older manager answers `400` and the
  gate fails open (`pinta.guard.fail_open_reason: error`), a newer manager that
  refuses a body answers `410`, recorded as `refused`.
- `@pinta-ai/core` `^0.6.0` → `^0.8.0` (`evaluateGuard(payload)`, `attachGuard`).

## [1.7.1] - 2026-09-19

### Fixed

- Collect the Claude Code product version from native installations, npm
  symlinks, pnpm launchers, and Windows npm shims. Resolve the actual executable
  before package lookup; use a bounded, shell-free `--version` probe when
  package metadata is unavailable. Fall back to PATH and the standard native
  installation directory only when `CLAUDE_CODE_EXECPATH` is absent.
- Share native version results across hook processes with an update-sensitive,
  bounded cache and short retries for failed probes. Preserve `unknown` with a
  stderr diagnostic on failure; never substitute the Pinta or Node version.
- Skip version probes when telemetry is disabled, and run regression tests in
  PR validation.

## [1.6.1] - 2026-07-20

### Changed

- `@pinta-ai/core` bumped `^0.3.0` → `^0.5.0` (devDependency, bundled
  into `dist/` at build). Pulls in the oversized-flush fix (pinta-manager#180
  follow-up): the retry queue now flushes in 900 KiB chunks instead of one
  unbounded POST, spans are capped at 800 KiB at build time, and a payload
  that alone exceeds the POST budget is dropped with a diagnostic instead of
  poisoning every later flush. No adaptor source change was needed.

## [1.5.1] - 2026-07-10

### Changed

- `@pinta-ai/core` bumped `^0.2.0` → `^0.3.0` (devDependency, bundled into
  `dist/` at build). The upgrade is additive; no adaptor source change was
  needed.

### Added

- `pinta.client.rtt_ms` / `pinta.client.op` span attributes on PreToolUse
  spans. `buildOtlpPayload` already forwards its `guard` result into core's
  `buildPayload`, and core `0.3.0` derives the client-call timing from the
  `GuardResult.clientRttMs` it now measures. The manager can only time its own
  handler, so `clientRttMs - durationMs` gives it the transport overhead.

### Fixed

- `tests/core/guard.test.ts` asserted the core `0.2.0` `GuardResult` shape with
  an exhaustive `toEqual` and broke once `clientRttMs` was added. It now matches
  that field by type, since it is a measured wall-clock rather than a value
  echoed from the response body.

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
