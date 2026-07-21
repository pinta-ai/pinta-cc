import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyClaudeCodePlugin, removeClaudeCodePlugin } from '../../src/enroll/claude-code-plugin';
import { parseEnvFile } from '../../src/enroll/env-file';
import { makeTokenResolver } from './test-utils';
import type { EnrollContext } from '../../src/enroll/types';

let tmpHome: string;
let tmpAdaptorRoot: string;
let tmpBackupRoot: string;

const HOOK_TEMPLATE = {
  hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/dist/index.js' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/dist/index.js' }] }],
  },
};

function setupAdaptorPackage(rootDir: string): void {
  // Mimic ~/.pinta/manager/adaptors/<id>/<version>/package layout.
  const pkgDir = path.join(rootDir, 'package');
  const claudePluginDir = path.join(pkgDir, '.claude-plugin');
  const hooksDir = path.join(pkgDir, 'hooks');
  fs.mkdirSync(claudePluginDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudePluginDir, 'plugin.json'),
    JSON.stringify({ name: 'pinta-cc', version: '1.3.0' }),
  );
  fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify(HOOK_TEMPLATE));
}

function makeCtx(overrides: Partial<EnrollContext> = {}): EnrollContext {
  return {
    adaptorId: 'pinta-cc',
    adaptorVersion: '1.3.0',
    adaptorRoot: tmpAdaptorRoot,
    homeDir: tmpHome,
    platform: 'darwin',
    // Default to the system-node branch — what the runner picks when
    // `node --version` succeeds. Substitution branch is exercised explicitly.
    nodePath: 'node',
    resolveToken: makeTokenResolver({ sidecarPort: 4318, relayToken: 'TEST-TOKEN' }),
    backupRoot: tmpBackupRoot,
    ...overrides,
  };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-home-'));
  // adaptorRoot path simulates ~/.pinta/manager/adaptors/pinta-cc/1.3.0
  const adaptorsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-adaptors-'));
  tmpAdaptorRoot = path.join(adaptorsRoot, 'pinta-cc', '1.3.0');
  fs.mkdirSync(tmpAdaptorRoot, { recursive: true });
  tmpBackupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-bak-'));
  setupAdaptorPackage(tmpAdaptorRoot);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  // tmpAdaptorRoot lives under another tmp dir; clean its grandparent.
  const adaptorsRoot = path.dirname(path.dirname(tmpAdaptorRoot));
  fs.rmSync(adaptorsRoot, { recursive: true, force: true });
  fs.rmSync(tmpBackupRoot, { recursive: true, force: true });
});

const install = {
  type: 'claude-code-plugin' as const,
  plugin_slug: 'pinta-cc@pinta-ai',
  plugin_root: 'package',
  user_config: { endpoint: 'relay-endpoint' as const, api_key: 'relay-token-raw' as const },
};

function readEnvFile(): Record<string, string> {
  const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
  return parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
}

describe('applyClaudeCodePlugin (Option C: settings.json hook merge + env-file)', () => {
  it('creates ~/.claude/settings.json and ~/.claude/pinta-cc.env on fresh install', async () => {
    const result = await applyClaudeCodePlugin(makeCtx(), install);
    expect(result.installed).toBe(true);
    expect(result.client).toBe('claude-code-plugin');

    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks?.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(1);

    // settings.json command is now bare `node <plugin>/dist/index.js` — no
    // shell env prefix (Phase 3b: cc-env-file.md).
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command as string;
    const pluginPath = path.join(tmpAdaptorRoot, 'package');
    expect(cmd).toBe(`node ${pluginPath}/dist/index.js`);
    expect(cmd).not.toMatch(/CLAUDE_PLUGIN_OPTION_/);
    expect(cmd).not.toMatch(/PINTA_GUARD_ENDPOINT/);
    expect(cmd).not.toMatch(/CLAUDE_PLUGIN_ROOT=/);

    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);

    // pinta-cc.env carries the env that used to be prefixed onto the command.
    const env = readEnvFile();
    expect(env.CLAUDE_PLUGIN_ROOT).toBe(pluginPath);
    expect(env.PINTA_GUARD_ENDPOINT).toBe('http://127.0.0.1:4318/guard/evaluate');
    expect(env.CLAUDE_PLUGIN_OPTION_ENDPOINT).toBe('http://127.0.0.1:4318/v1/traces');
    expect(env.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('TEST-TOKEN');
  });

  it('on win32, routes the hook through a .cmd wrapper instead of a quoted node path', async () => {
    const bundled = 'C:/Program Files/Pinta Manager/node.exe';
    await applyClaudeCodePlugin(makeCtx({ platform: 'win32', nodePath: bundled }), install);

    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command as string;
    // settings.json points at the wrapper, not the quoted node.exe path.
    expect(cmd).toMatch(/pinta-hook-[0-9a-f]{8}\.cmd$/);
    expect(cmd).not.toContain('node.exe');

    const pkgDir = path.join(tmpAdaptorRoot, 'package');
    // PreToolUse + UserPromptSubmit share an identical resolved command → one wrapper.
    const cmdFiles = fs.readdirSync(pkgDir).filter((f) => f.endsWith('.cmd'));
    expect(cmdFiles).toHaveLength(1);
    const content = fs.readFileSync(path.join(pkgDir, cmdFiles[0]!), 'utf-8');
    expect(content.startsWith('@echo off')).toBe(true);
    expect(content).toContain('exit /b %ERRORLEVEL%');
    const winDist = path.join(pkgDir, 'dist', 'index.js').replace(/\//g, '\\');
    expect(content).toContain(winDist);
  });

  it('does not create a .cmd wrapper on non-Windows', async () => {
    await applyClaudeCodePlugin(makeCtx({ platform: 'darwin' }), install);
    const pkgDir = path.join(tmpAdaptorRoot, 'package');
    expect(fs.readdirSync(pkgDir).some((f) => f.endsWith('.cmd'))).toBe(false);
  });

  it('preserves unrelated hook entries (other tools, e.g., cmux) under same event', async () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: '/usr/local/bin/cmux claude-hook pre-tool-use' }] },
          ],
        },
      }),
    );

    await applyClaudeCodePlugin(makeCtx(), install);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    // cmux entry preserved
    const commands = settings.hooks.PreToolUse.flatMap(
      (m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command),
    );
    expect(commands.some((c: string) => c.includes('cmux claude-hook'))).toBe(true);
    expect(commands.some((c: string) => c.includes(tmpAdaptorRoot))).toBe(true);
  });

  it('strips manager-owned entries from prior version on re-apply (no duplicates)', async () => {
    await applyClaudeCodePlugin(makeCtx(), install);
    // Simulate an upgrade: same adaptorId, new version under same parent dir
    const adaptorsParent = path.dirname(path.dirname(tmpAdaptorRoot));
    const newRoot = path.join(adaptorsParent, 'pinta-cc', '1.3.1');
    fs.mkdirSync(newRoot, { recursive: true });
    setupAdaptorPackage(newRoot);

    await applyClaudeCodePlugin(
      makeCtx({ adaptorRoot: newRoot, adaptorVersion: '1.3.1' }),
      install,
    );

    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command as string;
    expect(cmd).toContain(path.join(newRoot, 'package'));
    // Old version's path no longer present in command
    expect(cmd).not.toContain(path.join(tmpAdaptorRoot, 'package'));

    // CLAUDE_PLUGIN_ROOT in env-file also tracks the new version.
    const env = readEnvFile();
    expect(env.CLAUDE_PLUGIN_ROOT).toBe(path.join(newRoot, 'package'));
  });

  it('rotates token values in pinta-cc.env without touching settings.json', async () => {
    await applyClaudeCodePlugin(makeCtx(), install);
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    const settingsBefore = fs.readFileSync(settingsPath, 'utf-8');

    const newCtx = makeCtx({
      resolveToken: makeTokenResolver({ sidecarPort: 4318, relayToken: 'NEW-TOKEN' }),
    });
    await applyClaudeCodePlugin(newCtx, install);

    // settings.json content is byte-identical — the only thing that changes
    // across token rotations is the env file (Q4 from cc-env-file.md).
    const settingsAfter = fs.readFileSync(settingsPath, 'utf-8');
    expect(settingsAfter).toBe(settingsBefore);

    const env = readEnvFile();
    expect(env.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('NEW-TOKEN');
  });

  it('writes a backup of pre-existing settings before mutating', async () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/some/other' }] }] } };
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    await applyClaudeCodePlugin(makeCtx(), install);

    const backups = fs.readdirSync(tmpBackupRoot);
    expect(backups.length).toBeGreaterThan(0);
    const settingsBackup = backups.find((n) => n.startsWith('settings.json.'));
    expect(settingsBackup).toBeDefined();
    const restored = JSON.parse(fs.readFileSync(path.join(tmpBackupRoot, settingsBackup!), 'utf-8'));
    expect(restored).toEqual(existing);
  });

  it('backs up a pre-existing pinta-cc.env on re-apply', async () => {
    // First apply creates the file.
    await applyClaudeCodePlugin(makeCtx(), install);

    // Wipe backup root to scope assertion to the second apply.
    fs.rmSync(tmpBackupRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpBackupRoot, { recursive: true });

    await applyClaudeCodePlugin(
      makeCtx({
        resolveToken: makeTokenResolver({ sidecarPort: 4318, relayToken: 'ROTATED' }),
      }),
      install,
    );

    const backups = fs.readdirSync(tmpBackupRoot);
    const envBackup = backups.find((n) => n.startsWith('pinta-cc.env.'));
    expect(envBackup).toBeDefined();
    const restoredEnv = parseEnvFile(
      fs.readFileSync(path.join(tmpBackupRoot, envBackup!), 'utf-8'),
    );
    expect(restoredEnv.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('TEST-TOKEN');
  });

  it('preserves user-set keys in pinta-cc.env that the manager does not own', async () => {
    const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'USER_KEY=preserved-value\nCLAUDE_PLUGIN_OPTION_API_KEY=old\n');

    await applyClaudeCodePlugin(makeCtx(), install);

    const env = readEnvFile();
    // user-set key kept
    expect(env.USER_KEY).toBe('preserved-value');
    // manager-owned key replaced
    expect(env.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('TEST-TOKEN');
  });

  it('atomic write — if plugin_root is missing, original settings remain unchanged', async () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/some/other' }] }] } };
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    await expect(
      applyClaudeCodePlugin(makeCtx({ adaptorRoot: '/nonexistent/path' }), install),
    ).rejects.toThrow();

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings).toEqual(existing);
    // env-file should also not have been written, since we throw before any write.
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'pinta-cc.env'))).toBe(false);
  });

  it('strips legacy plugin registration from .claude.json on apply (one-time cleanup)', async () => {
    const claudeJsonPath = path.join(tmpHome, '.claude.json');
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        extraKnownPlugins: {
          'pinta-cc@pinta-ai': {
            name: 'pinta-cc@pinta-ai',
            type: 'filesystem',
            managedBy: 'pinta-manager',
          },
          'other@plugin': { name: 'other@plugin' },
        },
        enabledPlugins: { 'pinta-cc@pinta-ai': true, 'other@plugin': true },
        pluginConfigs: { 'pinta-cc@pinta-ai': { endpoint: 'old' } },
      }),
    );

    await applyClaudeCodePlugin(makeCtx(), install);

    const cleaned = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    expect(cleaned.extraKnownPlugins['pinta-cc@pinta-ai']).toBeUndefined();
    expect(cleaned.enabledPlugins['pinta-cc@pinta-ai']).toBeUndefined();
    expect(cleaned.pluginConfigs['pinta-cc@pinta-ai']).toBeUndefined();
    // Other entries preserved
    expect(cleaned.extraKnownPlugins['other@plugin']).toBeDefined();
    expect(cleaned.enabledPlugins['other@plugin']).toBe(true);
  });

  it('strips manager entries from installed_plugins.json on apply (one-time cleanup)', async () => {
    const registryPath = path.join(tmpHome, '.claude', 'plugins', 'installed_plugins.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        version: 2,
        plugins: {
          'pinta-cc@pinta-ai': [
            {
              scope: 'user',
              installPath: '/some/old/path',
              version: '1.0.0',
              managedBy: 'pinta-manager',
            },
            {
              scope: 'user',
              installPath: '/marketplace/cache',
              version: '2.0.0',
              gitCommitSha: 'abc',
            },
          ],
        },
      }),
    );

    await applyClaudeCodePlugin(makeCtx(), install);

    const reg = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    // manager-managed entry stripped, user-installed entry preserved
    expect(reg.plugins['pinta-cc@pinta-ai']).toHaveLength(1);
    expect(reg.plugins['pinta-cc@pinta-ai'][0].managedBy).toBeUndefined();
    expect(reg.plugins['pinta-cc@pinta-ai'][0].installPath).toBe('/marketplace/cache');
  });

  it('substitutes the leading `node` token with ctx.nodePath when not bare', async () => {
    const bundled = '/bundled/node';
    await applyClaudeCodePlugin(makeCtx({ nodePath: bundled }), install);

    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
    );
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command as string;
    const pluginPath = path.join(tmpAdaptorRoot, 'package');
    // Substituted: bundled node path replaces the leading `node` token,
    // and the `${CLAUDE_PLUGIN_ROOT}` expansion is preserved verbatim.
    expect(cmd).toBe(`${bundled} ${pluginPath}/dist/index.js`);
  });

  it('forward-slashes and shell-quotes a node path with spaces (Program Files case)', async () => {
    const bundled = 'C:\\Program Files\\PintaManager\\node.exe';
    await applyClaudeCodePlugin(makeCtx({ nodePath: bundled }), install);

    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
    );
    const cmd = settings.hooks.PreToolUse[0].hooks[0].command as string;
    // Windows interpreter path is rendered with forward slashes (so the hook
    // shell doesn't eat the backslashes) and quoted for the embedded space. The
    // quote char (single on POSIX host, double on win32) is asserted in
    // node-binary.test.ts; here we pin the platform-independent guarantees.
    expect(cmd).toContain('C:/Program Files/PintaManager/node.exe');
    expect(cmd).not.toContain('\\');
    expect(cmd).toMatch(/^["']C:\/Program Files\/PintaManager\/node\.exe["'] /);
  });

  it('preserves unrelated keys in ~/.claude/settings.json', async () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ theme: 'dark', someOther: { nested: 'value' } }),
    );

    await applyClaudeCodePlugin(makeCtx(), install);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.someOther).toEqual({ nested: 'value' });
    expect(settings.hooks?.PreToolUse).toBeDefined();
  });
});

describe('removeClaudeCodePlugin', () => {
  it('removes manager-owned hook entries; leaves unrelated hook entries alone; sweeps env file', async () => {
    const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: '/usr/local/bin/cmux claude-hook pre-tool-use' }] },
          ],
        },
      }),
    );
    await applyClaudeCodePlugin(makeCtx(), install);

    let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
    expect(fs.existsSync(envPath)).toBe(true);

    await removeClaudeCodePlugin(makeCtx(), install);

    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('cmux');
    // env-file sweep
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('returns gracefully when settings.json does not exist', async () => {
    const result = await removeClaudeCodePlugin(makeCtx(), install);
    expect(result.installed).toBe(false);
    expect(result.client).toBe('claude-code-plugin');
  });

  it('removes pinta-cc.env even when settings.json carries no manager hooks', async () => {
    // Simulate a state where the env file exists but the user already cleared
    // settings.json — remove should still sweep the env file.
    const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, 'CLAUDE_PLUGIN_OPTION_API_KEY=stale\n');

    await removeClaudeCodePlugin(makeCtx(), install);

    expect(fs.existsSync(envPath)).toBe(false);
  });
});
