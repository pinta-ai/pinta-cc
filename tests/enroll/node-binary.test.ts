import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  substituteNodeBinary,
  quoteShellPath,
  toCommandPath,
  windowsHookWrapperName,
  windowsHookWrapperContent,
  maybeWrapHookCommandForWindows,
  renderHookCommand,
} from '../../src/enroll/node-binary';

describe('substituteNodeBinary', () => {
  it('returns the command unchanged when nodeBinary is the bare `node` token', () => {
    const cmd = 'node /path/to/index.js --flag';
    expect(substituteNodeBinary(cmd, 'node')).toBe(cmd);
  });

  it('replaces leading `node ` with the resolved binary path', () => {
    const cmd = 'node /path/to/index.js --flag';
    expect(substituteNodeBinary(cmd, '/usr/local/bin/node')).toBe(
      '/usr/local/bin/node /path/to/index.js --flag',
    );
  });

  it('forward-slashes a Windows binary path with no spaces (no quoting needed)', () => {
    expect(substituteNodeBinary('node x.js', 'C:\\Tools\\node.exe')).toBe('C:/Tools/node.exe x.js');
  });

  it('leaves commands using a different runtime alone', () => {
    expect(substituteNodeBinary('python script.py', '/bundled/node')).toBe('python script.py');
    expect(substituteNodeBinary('/usr/bin/env node x.js', '/bundled/node')).toBe(
      '/usr/bin/env node x.js',
    );
  });

  it('handles `node` as the entire command (no args)', () => {
    expect(substituteNodeBinary('node', '/bundled/node')).toBe('/bundled/node');
  });

  it('does not match `node` mid-token (e.g., `nodemon`)', () => {
    expect(substituteNodeBinary('nodemon x.js', '/bundled/node')).toBe('nodemon x.js');
  });
});

describe('toCommandPath', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(toCommandPath('C:\\Users\\u\\.pinta\\adaptors\\pinta-cc\\1.3.1\\package')).toBe(
      'C:/Users/u/.pinta/adaptors/pinta-cc/1.3.1/package',
    );
  });

  it('leaves POSIX paths (already forward-slashed) untouched', () => {
    expect(toCommandPath('/home/u/.pinta/adaptors/pinta-cc/1.3.1/package')).toBe(
      '/home/u/.pinta/adaptors/pinta-cc/1.3.1/package',
    );
  });

  it('normalizes mixed separators (the real enrolled shape)', () => {
    // pluginAbsPath joins with `\` then the template appends `/dist/index.js`.
    expect(toCommandPath('C:\\Users\\u\\package/dist/index.js')).toBe(
      'C:/Users/u/package/dist/index.js',
    );
  });
});

describe('quoteShellPath', () => {
  it('returns simple paths unchanged (platform-independent)', () => {
    expect(quoteShellPath('/usr/local/bin/node')).toBe('/usr/local/bin/node');
    expect(quoteShellPath('node')).toBe('node');
    expect(quoteShellPath('C:\\Tools\\node.exe')).toBe('C:\\Tools\\node.exe');
  });
});

// Quoting style depends on the OS the manager enrolled on (= the OS the hook
// runs on), so these stub `process.platform` to stay deterministic regardless
// of the host running the tests.
describe('quoteShellPath — POSIX host', () => {
  const real = process.platform;
  beforeAll(() => Object.defineProperty(process, 'platform', { value: 'linux', configurable: true }));
  afterAll(() => Object.defineProperty(process, 'platform', { value: real, configurable: true }));

  it('single-quotes paths containing spaces', () => {
    expect(quoteShellPath('/Applications/My App/node')).toBe("'/Applications/My App/node'");
  });

  it('escapes embedded single quotes', () => {
    expect(quoteShellPath("/odd'path/node")).toBe(`'/odd'\\''path/node'`);
  });

  it('forward-slashes and single-quotes a spaced Windows node path', () => {
    expect(substituteNodeBinary('node /p/index.js', 'C:\\Program Files\\Node\\node.exe')).toBe(
      "'C:/Program Files/Node/node.exe' /p/index.js",
    );
  });
});

describe('quoteShellPath — Windows host', () => {
  const real = process.platform;
  beforeAll(() => Object.defineProperty(process, 'platform', { value: 'win32', configurable: true }));
  afterAll(() => Object.defineProperty(process, 'platform', { value: real, configurable: true }));

  it('double-quotes a spaced path so cmd.exe, PowerShell and git-bash all accept it', () => {
    expect(quoteShellPath('C:/Program Files/Node/node.exe')).toBe('"C:/Program Files/Node/node.exe"');
  });

  it('forward-slashes and double-quotes a Program Files (x86) node path (parens + space)', () => {
    expect(substituteNodeBinary('node /p/index.js', 'C:\\Program Files (x86)\\Node\\node.exe')).toBe(
      '"C:/Program Files (x86)/Node/node.exe" /p/index.js',
    );
  });

  it('leaves a no-space forward-slashed path unquoted', () => {
    expect(substituteNodeBinary('node x.js', 'C:\\Tools\\node.exe')).toBe('C:/Tools/node.exe x.js');
  });
});

describe('windowsHookWrapperContent', () => {
  it('converts separators to backslashes, forwards args, and propagates exit code', () => {
    const content = windowsHookWrapperContent(
      '"C:/Program Files/Pinta Manager/node.exe" C:/Users/u/.pinta/adaptors/pinta-codex/1.2.4/package/dist/index.js',
    );
    expect(content).toBe(
      [
        '@echo off',
        '"C:\\Program Files\\Pinta Manager\\node.exe" C:\\Users\\u\\.pinta\\adaptors\\pinta-codex\\1.2.4\\package\\dist\\index.js %*',
        'exit /b %ERRORLEVEL%',
        '',
      ].join('\r\n'),
    );
  });
});

describe('windowsHookWrapperName', () => {
  it('is deterministic per command and distinct across commands', () => {
    const a = windowsHookWrapperName('node a.js');
    expect(a).toMatch(/^pinta-hook-[0-9a-f]{8}\.cmd$/);
    expect(windowsHookWrapperName('node a.js')).toBe(a);
    expect(windowsHookWrapperName('node b.js')).not.toBe(a);
  });
});

describe('renderHookCommand', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-render-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('substitutes node + leaves the command direct on non-Windows', () => {
    expect(renderHookCommand('node /p/index.js', '/bundled/node', 'darwin', dir)).toBe(
      '/bundled/node /p/index.js',
    );
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.cmd'))).toHaveLength(0);
  });

  it('substitutes node + wraps in a .cmd token on win32', () => {
    const token = renderHookCommand('node C:/x/index.js', 'C:/Program Files/Pinta Manager/node.exe', 'win32', dir);
    expect(token).toMatch(/pinta-hook-[0-9a-f]{8}\.cmd$/);
    expect(token).not.toContain('node.exe');
    expect(fs.existsSync(path.join(dir, path.basename(token)))).toBe(true);
  });
});

describe('maybeWrapHookCommandForWindows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmgr-wrap-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns the command unchanged and writes nothing on non-Windows', () => {
    const cmd = '/bundled/node /p/index.js';
    expect(maybeWrapHookCommandForWindows(cmd, 'darwin', dir)).toBe(cmd);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.cmd'))).toHaveLength(0);
  });

  it('on win32 writes a .cmd launcher and returns the wrapper-path token', () => {
    const resolved = '"C:/Program Files/Pinta Manager/node.exe" C:/x/dist/index.js';
    const token = maybeWrapHookCommandForWindows(resolved, 'win32', dir);
    expect(token).toMatch(/pinta-hook-[0-9a-f]{8}\.cmd$/);
    expect(token).not.toContain('node.exe');
    const wrapperFile = path.join(dir, path.basename(token));
    expect(fs.existsSync(wrapperFile)).toBe(true);
    expect(fs.readFileSync(wrapperFile, 'utf-8')).toBe(windowsHookWrapperContent(resolved));
  });
});
