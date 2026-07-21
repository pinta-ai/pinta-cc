// Ported from pinta-manager `sidecar/src/enroll/claude-code-plugin.ts` —
// behavior-identical; only the context/install types changed to the mirrored
// enroll contract (`src/enroll/types.ts`).

import fs from "node:fs";
import path from "node:path";
import type { EnrollApplyResult, EnrollContext } from "./types.js";
import { writeAtomicWithBackup } from "./fs-util.js";
import { renderHookCommand, toCommandPath } from "./node-binary.js";
import { isManagerOwnedHookCommand } from "./hook-ownership.js";
import { mergeAndWriteEnvFile } from "./hook-env.js";

// ~/.claude/settings.json — Claude Code's user-scope settings; we merge hook
// entries here directly under the `hooks` key. This bypasses Claude Code's
// plugin system entirely. Hooks defined here run in every Claude Code session
// regardless of plugin enable/disable state, marketplace cache, or
// installed_plugins.json — they are the same mechanism cmux uses (via
// `--settings`).
const USER_SETTINGS_FILE = path.join(".claude", "settings.json");
// ~/.claude/pinta-cc.env — env-file source-of-truth for hook env vars
// (CLAUDE_PLUGIN_ROOT, PINTA_GUARD_ENDPOINT, CLAUDE_PLUGIN_OPTION_*). The
// pinta-cc adaptor (>=1.3.0) loads this at startup and merges into
// process.env.
const USER_ENV_FILE = path.join(".claude", "pinta-cc.env");
// ~/.claude.json — legacy plugin runtime state. Option C does not write here;
// we only scrub stale manager-managed entries left over from earlier versions.
const LEGACY_SETTINGS_FILE = ".claude.json";
const LEGACY_INSTALLED_PLUGINS_FILE = path.join(".claude", "plugins", "installed_plugins.json");
const MANAGED_BY = "pinta-manager";

/** The catalog manifest `install` block for the `claude-code-plugin` type. */
export interface ClaudeCodePluginInstall {
  plugin_root: string;
  plugin_slug: string;
  user_config: Record<string, string>;
}

/** Result shape: the contract's EnrollApplyResult plus the client id the manager records. */
export interface ClaudeCodeEnrollResult extends EnrollApplyResult {
  client: "claude-code-plugin";
}

/** Narrow a raw manifest install block; throws on a malformed shape. */
export function asClaudeCodePluginInstall(raw: Record<string, unknown>): ClaudeCodePluginInstall {
  const plugin_root = raw.plugin_root;
  const plugin_slug = raw.plugin_slug;
  const user_config = raw.user_config;
  if (typeof plugin_root !== "string" || typeof plugin_slug !== "string") {
    throw new Error("claude-code-plugin: install block missing plugin_root/plugin_slug");
  }
  const config: Record<string, string> = {};
  if (user_config && typeof user_config === "object") {
    for (const [k, v] of Object.entries(user_config)) {
      if (typeof v === "string") config[k] = v;
    }
  }
  return { plugin_root, plugin_slug, user_config: config };
}

function resolveTokenMap(
  map: Record<string, string>,
  resolver: (source: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = resolver(v);
  }
  return out;
}

interface SettingsHookEntry {
  type: string;
  command: string;
  [k: string]: unknown;
}

interface SettingsHookMatcher {
  matcher?: string;
  hooks: SettingsHookEntry[];
  [k: string]: unknown;
}

interface UserSettings {
  hooks?: Record<string, SettingsHookMatcher[]>;
  [k: string]: unknown;
}

interface HooksTemplate {
  hooks?: Record<string, SettingsHookMatcher[]>;
}

function readUserSettings(p: string): UserSettings {
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && typeof parsed === "object") return parsed as UserSettings;
  } catch {
    /* fall through — treat as empty */
  }
  return {};
}

function readHooksTemplate(pluginAbsPath: string): HooksTemplate {
  const hooksPath = path.join(pluginAbsPath, "hooks", "hooks.json");
  if (!fs.existsSync(hooksPath)) return { hooks: {} };
  const raw = fs.readFileSync(hooksPath, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as HooksTemplate;
  } catch {
    /* fall through */
  }
  return { hooks: {} };
}

/**
 * Build the env vars written to ~/.claude/pinta-cc.env. Claude Code's plugin
 * system normally maps `plugin.json:userConfig.<key>` → `CLAUDE_PLUGIN_OPTION_<KEY>`
 * at hook-spawn time. Option C bypasses the plugin system, so we surface those
 * env vars via the env-file; pinta-cc (>=1.3.0) reads it at startup and
 * merges into process.env, then its env-bridge converts CLAUDE_PLUGIN_OPTION_*
 * to OTEL_* before transport runs.
 *
 * `PINTA_GUARD_ENDPOINT` is also injected so pinta-cc's PreToolUse hook can
 * call the manager's guard endpoint synchronously (50 ms timeout, fail-open).
 * When the env var is absent (OSS user without manager) the hook skips guard.
 */
function buildHookEnv(
  pluginAbsPath: string,
  resolvedConfig: Record<string, string>,
  guardEndpoint: string,
): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: pluginAbsPath,
    PINTA_GUARD_ENDPOINT: guardEndpoint,
  };
  for (const [key, value] of Object.entries(resolvedConfig)) {
    env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = value;
  }
  return env;
}

function expandPluginRoot(command: string, pluginAbsPath: string): string {
  return command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginAbsPath);
}

function buildIncomingHooks(
  template: HooksTemplate,
  pluginAbsPath: string,
  nodePath: string,
  platform: NodeJS.Platform,
): Record<string, SettingsHookMatcher[]> {
  const out: Record<string, SettingsHookMatcher[]> = {};
  for (const [event, matchers] of Object.entries(template.hooks ?? {})) {
    out[event] = matchers.map((m) => ({
      ...(m.matcher !== undefined ? { matcher: m.matcher } : {}),
      hooks: m.hooks.map((h) => ({
        ...h,
        type: h.type ?? "command",
        // No env prefix — hook env now lives in ~/.claude/pinta-cc.env (loaded
        // by the pinta-cc adaptor at startup). substituteNodeBinary rewrites
        // the leading `node` token when the manager has detected/bundled a
        // specific Node binary.
        // Forward-slash the plugin root before it enters the command string —
        // a Windows backslash path is mangled by the shell that runs the hook
        // (Cannot find module). The native-separator pluginAbsPath is still
        // used for CLAUDE_PLUGIN_ROOT (env file) and fs checks elsewhere.
        // On Windows, wrap the rendered command in a `.cmd` launcher (written
        // into the plugin root) so a quoted bundled-node path with spaces is
        // not mis-tokenized by Claude Code's hook runner.
        command: renderHookCommand(
          expandPluginRoot(h.command, toCommandPath(pluginAbsPath)),
          nodePath,
          platform,
          pluginAbsPath,
        ),
      })),
    }));
  }
  return out;
}

function stripManagerOwned(
  matchers: SettingsHookMatcher[],
  adaptorRoot: string,
): SettingsHookMatcher[] {
  return matchers
    .map((m) => ({
      ...m,
      hooks: m.hooks.filter((h) => !isManagerOwnedHookCommand(h.command ?? "", adaptorRoot)),
    }))
    .filter((m) => m.hooks.length > 0);
}

export async function applyClaudeCodePlugin(
  ctx: EnrollContext,
  rawInstall: Record<string, unknown>,
): Promise<ClaudeCodeEnrollResult> {
  const install = asClaudeCodePluginInstall(rawInstall);
  const pluginAbsPath = path.join(ctx.adaptorRoot, install.plugin_root);
  if (!fs.existsSync(path.join(pluginAbsPath, ".claude-plugin", "plugin.json"))) {
    throw new Error(
      `claude-code-plugin: plugin_root missing or malformed: ${pluginAbsPath}`,
    );
  }

  const template = readHooksTemplate(pluginAbsPath);
  const resolvedConfig = resolveTokenMap(install.user_config, ctx.resolveToken);
  const guardEndpoint = ctx.resolveToken("relay-guard-endpoint");
  const newEnv = buildHookEnv(pluginAbsPath, resolvedConfig, guardEndpoint);
  const incoming = buildIncomingHooks(template, pluginAbsPath, ctx.nodePath, ctx.platform);

  const settingsPath = path.join(ctx.homeDir, USER_SETTINGS_FILE);
  const envFilePath = path.join(ctx.homeDir, USER_ENV_FILE);
  const settings = readUserSettings(settingsPath);
  settings.hooks ??= {};

  const events = new Set<string>([
    ...Object.keys(settings.hooks),
    ...Object.keys(incoming),
  ]);
  for (const event of events) {
    const stripped = stripManagerOwned(settings.hooks[event] ?? [], ctx.adaptorRoot);
    const fresh = incoming[event] ?? [];
    const next = [...stripped, ...fresh];
    if (next.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = next;
    }
  }

  await writeAtomicWithBackup(
    settingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    ctx.backupRoot,
  );

  // Write ~/.claude/pinta-cc.env. Mirror codex's merge semantics: preserve any
  // user-set keys not in our generated map, but always overwrite the keys we
  // own. writeAtomicWithBackup snapshots the previous file on every write, so
  // a token rotation lands as a backup in ctx.backupRoot.
  await mergeAndWriteEnvFile(envFilePath, newEnv, ctx.backupRoot);

  await cleanupLegacyPluginRegistration(ctx.homeDir, install.plugin_slug, ctx.backupRoot);

  return {
    client: "claude-code-plugin",
    installed: true,
    configPath: settingsPath,
    details: { plugin_slug: install.plugin_slug, plugin_path: pluginAbsPath, env_file: envFilePath },
  };
}

export async function removeClaudeCodePlugin(
  ctx: EnrollContext,
  rawInstall: Record<string, unknown>,
): Promise<ClaudeCodeEnrollResult> {
  const install = asClaudeCodePluginInstall(rawInstall);
  const settingsPath = path.join(ctx.homeDir, USER_SETTINGS_FILE);
  const envFilePath = path.join(ctx.homeDir, USER_ENV_FILE);
  const settings = readUserSettings(settingsPath);

  let mutated = false;
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const before = settings.hooks[event];
      const after = stripManagerOwned(before, ctx.adaptorRoot);
      const droppedHooks = countHooks(before) !== countHooks(after);
      if (droppedHooks) mutated = true;
      if (after.length === 0) {
        delete settings.hooks[event];
      } else {
        settings.hooks[event] = after;
      }
    }
  }

  if (mutated) {
    await writeAtomicWithBackup(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      ctx.backupRoot,
    );
  }

  // Sweep the env file — it is entirely manager-managed (the adaptor only
  // reads from it). writeAtomicWithBackup already captured a snapshot on the
  // most recent apply, so no additional backup is needed before unlink.
  if (fs.existsSync(envFilePath)) {
    fs.unlinkSync(envFilePath);
  }

  await cleanupLegacyPluginRegistration(ctx.homeDir, install.plugin_slug, ctx.backupRoot);

  return { client: "claude-code-plugin", installed: false, configPath: settingsPath };
}

function countHooks(matchers: SettingsHookMatcher[]): number {
  return matchers.reduce((sum, m) => sum + m.hooks.length, 0);
}

/**
 * Strip any stale plugin-style registration this adaptor used to write back
 * when manager registered itself as a Claude Code plugin (pre-Option C).
 * Only entries with `managedBy === 'pinta-manager'` are removed; user-owned
 * entries under the same slug are preserved.
 */
async function cleanupLegacyPluginRegistration(
  homeDir: string,
  slug: string,
  backupRoot: string,
): Promise<void> {
  const legacyPath = path.join(homeDir, LEGACY_SETTINGS_FILE);
  if (fs.existsSync(legacyPath)) {
    let parsed: Record<string, unknown> | null = null;
    try {
      const obj = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
      if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
    } catch {
      /* leave malformed file alone */
    }
    if (parsed) {
      let changed = false;
      const known = parsed.extraKnownPlugins as
        | Record<string, { managedBy?: string }>
        | undefined;
      if (known && known[slug] && known[slug].managedBy === MANAGED_BY) {
        delete known[slug];
        changed = true;
      }
      const enabled = parsed.enabledPlugins as Record<string, unknown> | undefined;
      if (enabled && slug in enabled) {
        delete enabled[slug];
        changed = true;
      }
      const configs = parsed.pluginConfigs as Record<string, unknown> | undefined;
      if (configs && slug in configs) {
        delete configs[slug];
        changed = true;
      }
      if (changed) {
        await writeAtomicWithBackup(
          legacyPath,
          JSON.stringify(parsed, null, 2) + "\n",
          backupRoot,
        );
      }
    }
  }

  const registryPath = path.join(homeDir, LEGACY_INSTALLED_PLUGINS_FILE);
  if (fs.existsSync(registryPath)) {
    let parsed: Record<string, unknown> | null = null;
    try {
      const obj = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
    } catch {
      return;
    }
    if (!parsed) return;
    const plugins = parsed.plugins as
      | Record<string, Array<{ managedBy?: string }>>
      | undefined;
    if (!plugins || !plugins[slug]) return;
    const remaining = plugins[slug].filter((e) => e.managedBy !== MANAGED_BY);
    if (remaining.length === plugins[slug].length) return;
    if (remaining.length === 0) {
      delete plugins[slug];
    } else {
      plugins[slug] = remaining;
    }
    await writeAtomicWithBackup(
      registryPath,
      JSON.stringify(parsed, null, 2) + "\n",
      backupRoot,
    );
  }
}
