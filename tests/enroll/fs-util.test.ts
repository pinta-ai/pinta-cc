import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeAtomicWithBackup } from '../../src/enroll/fs-util';

describe('writeAtomicWithBackup', () => {
  let dir: string;
  let filePath: string;
  let backupRoot: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pinta-fsutil-'));
    filePath = path.join(dir, 'config.toml');
    backupRoot = path.join(dir, 'backups');
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const backupCount = () =>
    fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).length : 0;

  it('writes a new file without creating a backup', async () => {
    await writeAtomicWithBackup(filePath, 'hello\n', backupRoot);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('hello\n');
    expect(backupCount()).toBe(0);
  });

  it('backs up the previous content when the file changes', async () => {
    await writeAtomicWithBackup(filePath, 'v1\n', backupRoot);
    await writeAtomicWithBackup(filePath, 'v2\n', backupRoot);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('v2\n');
    expect(backupCount()).toBe(1);
    const [bak] = fs.readdirSync(backupRoot);
    expect(await fsp.readFile(path.join(backupRoot, bak), 'utf-8')).toBe('v1\n');
  });

  it('does not back up or rewrite when content is unchanged', async () => {
    await writeAtomicWithBackup(filePath, 'same\n', backupRoot);
    // Re-enroll many times with identical content — the old bug flooded
    // backupRoot with one .bak per call.
    for (let i = 0; i < 5; i++) {
      await writeAtomicWithBackup(filePath, 'same\n', backupRoot);
    }
    expect(backupCount()).toBe(0);
    expect(await fsp.readFile(filePath, 'utf-8')).toBe('same\n');
  });
});
