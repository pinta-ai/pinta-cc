/**
 * Restoration scenario tests for applyClaudeCodePlugin (Option C).
 *
 * Each test sets up ~/.claude/settings.json in a damaged or user-mutated
 * state, calls applyClaudeCodePlugin, then asserts the file ends up in a
 * canonical state (manager-owned hook entries present, unrelated content
 * preserved).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyClaudeCodePlugin } from '../../src/enroll/claude-code-plugin';
import { parseEnvFile } from '../../src/enroll/env-file';
import { makeTokenResolver } from './test-utils';
import type { EnrollContext } from '../../src/enroll/types';

let tmpHome: string;
let tmpAdaptorRoot: string;
let tmpBackupRoot: string;

const HOOK_TEMPLATE = {
  hooks: {
    PreToolUse: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/dist/index.js' }] }],
  },
};

function setupAdaptorPackage(rootDir: string): void {
  const pkgDir = path.join(rootDir, 'package');
  const claudePluginDir = path.join(pkgDir, '.claude-plugin');
  const hooksDir = path.join(pkgDir, 'hooks');
  fs.mkdirSync(claudePluginDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudePluginDir, 'plugin.json'),
    JSON.stringify({ name: 'pinta-cc', version: '1.2.0' }),
  );
  fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify(HOOK_TEMPLATE));
}

function makeCtx(overrides: Partial<EnrollContext> = {}): EnrollContext {
  return {
    adaptorId: 'pinta-cc',
    adaptorVersion: '1.2.0',
    adaptorRoot: tmpAdaptorRoot,
    homeDir: tmpHome,
    platform: 'darwin',
    nodePath: process.execPath,
    resolveToken: makeTokenResolver({ sidecarPort: 4318, relayToken: 'TEST-TOKEN' }),
    backupRoot: tmpBackupRoot,
    ...overrides,
  };
}

const install = {
  type: 'claude-code-plugin' as const,
  plugin_slug: 'pinta-cc@pinta-ai',
  plugin_root: 'package',
  user_config: { endpoint: 'relay-endpoint' as const, api_key: 'relay-token-raw' as const },
};

async function runApply(): Promise<void> {
  await applyClaudeCodePlugin(makeCtx(), install);
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-restore-home-'));
  const adaptorsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-restore-adaptors-'));
  tmpAdaptorRoot = path.join(adaptorsRoot, 'pinta-cc', '1.2.0');
  fs.mkdirSync(tmpAdaptorRoot, { recursive: true });
  tmpBackupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-cc-restore-bak-'));
  setupAdaptorPackage(tmpAdaptorRoot);
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(path.dirname(path.dirname(tmpAdaptorRoot)), { recursive: true, force: true });
  fs.rmSync(tmpBackupRoot, { recursive: true, force: true });
});

function readSettings(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8'),
  );
}

function expectManagerHook(settings: Record<string, unknown>): void {
  const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  expect(hooks?.PreToolUse).toBeDefined();
  const cmds = hooks.PreToolUse.flatMap((m) => m.hooks.map((h) => h.command));
  expect(cmds.some((c) => c.includes(tmpAdaptorRoot))).toBe(true);
}

describe('applyClaudeCodePlugin – restoration scenarios (Option C)', () => {
  it('A: settings.json is empty string — file rewritten with manager hooks', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');

    await runApply();
    expectManagerHook(readSettings());
  });

  it('B: settings.json is {} — manager hooks added', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}');

    await runApply();
    expectManagerHook(readSettings());
  });

  it('C: hooks key was deleted — re-created with manager entries', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ theme: 'dark' }));

    await runApply();
    const settings = readSettings();
    expect(settings.theme).toBe('dark');
    expectManagerHook(settings);
  });

  it('D: manager hook entries removed; unrelated hooks preserved — manager re-added', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: '/usr/local/bin/cmux claude-hook pre-tool-use' }] },
          ],
          Stop: [{ hooks: [{ type: 'command', command: '/some/user/hook' }] }],
        },
      }),
    );

    await runApply();
    const settings = readSettings();
    expectManagerHook(settings);
    const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    // cmux still present alongside manager entry
    const preCmds = hooks.PreToolUse.flatMap((m) => m.hooks.map((h) => h.command));
    expect(preCmds.some((c) => c.includes('cmux'))).toBe(true);
    // Unrelated event untouched
    expect(hooks.Stop[0].hooks[0].command).toBe('/some/user/hook');
  });

  it('E: file deleted — file created with manager hooks', async () => {
    await runApply();
    expectManagerHook(readSettings());
  });

  it('F: malformed JSON — treated as empty, manager hooks added', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'garbage {{{not json');

    await runApply();
    expectManagerHook(readSettings());
  });

  it('G: hooks.PreToolUse exists but as empty array — manager entry appended', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ hooks: { PreToolUse: [] } }));

    await runApply();
    expectManagerHook(readSettings());
  });

  it('H: stale manager entry under different version path — replaced with current', async () => {
    const p = path.join(tmpHome, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const adaptorsParent = path.dirname(path.dirname(tmpAdaptorRoot));
    const oldVersionPath = path.join(adaptorsParent, 'pinta-cc', '1.0.0', 'package', 'dist', 'index.js');
    // Pre-Phase-3b shape — the stale entry still carries the old POSIX env
    // prefix. The strip logic keys on adaptorPathPrefix, so this should be
    // recognised as manager-owned and replaced with the current bare-command
    // form regardless of the prefix.
    fs.writeFileSync(
      p,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `CLAUDE_PLUGIN_OPTION_API_KEY='OLD' node ${oldVersionPath}`,
                },
              ],
            },
          ],
        },
      }),
    );

    await runApply();
    const settings = readSettings();
    const hooks = settings.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    const preCmds = hooks.PreToolUse.flatMap((m) => m.hooks.map((h) => h.command));
    // Only the current-version entry remains; old version stripped.
    expect(preCmds).toHaveLength(1);
    expect(preCmds[0]).toContain(tmpAdaptorRoot);
    expect(preCmds[0]).not.toContain('1.0.0');
    expect(preCmds[0]).not.toContain('OLD');
    // The replacement carries no env prefix (Phase 3b).
    expect(preCmds[0]).not.toMatch(/CLAUDE_PLUGIN_OPTION_/);
  });

  it('I: pinta-cc.env file missing — re-created with manager-owned keys', async () => {
    await runApply();
    const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
    fs.unlinkSync(envPath);

    await runApply();
    expect(fs.existsSync(envPath)).toBe(true);
    const env = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
    expect(env.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('TEST-TOKEN');
    expect(env.CLAUDE_PLUGIN_OPTION_ENDPOINT).toBe('http://127.0.0.1:4318/v1/traces');
    expect(env.PINTA_GUARD_ENDPOINT).toBe('http://127.0.0.1:4318/guard/evaluate');
    expect(env.CLAUDE_PLUGIN_ROOT).toBe(path.join(tmpAdaptorRoot, 'package'));
  });

  it('J: pinta-cc.env mutated by user — manager keys restored, user keys preserved', async () => {
    await runApply();
    const envPath = path.join(tmpHome, '.claude', 'pinta-cc.env');
    fs.writeFileSync(
      envPath,
      'CLAUDE_PLUGIN_OPTION_API_KEY=user-tampered\nUSER_KEY=keep-me\n',
    );

    await runApply();
    const env = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
    expect(env.CLAUDE_PLUGIN_OPTION_API_KEY).toBe('TEST-TOKEN');
    expect(env.USER_KEY).toBe('keep-me');
  });
});
