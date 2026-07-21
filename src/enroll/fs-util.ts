// Ported verbatim from pinta-manager `sidecar/src/enroll/fs-util.ts`.

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

/**
 * Atomic file write with timestamped backup.
 * - If file exists and content is unchanged: no-op (no backup, no rewrite).
 * - If file exists with different content: backup to
 *   <backupRoot>/<basename>.<ISO>.bak, then write.
 * - Write to <path>.tmp, rename to <path>
 */
export async function writeAtomicWithBackup(
  filePath: string,
  content: string,
  backupRoot: string,
): Promise<void> {
  if (fs.existsSync(filePath)) {
    // Skip entirely when nothing changed — otherwise every enroll cycle
    // snapshots an identical file and floods backupRoot with junk .bak files.
    const existing = await fsp.readFile(filePath, "utf-8");
    if (existing === content) {
      return;
    }
    await fsp.mkdir(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = path.basename(filePath);
    await fsp.copyFile(filePath, path.join(backupRoot, `${name}.${stamp}.bak`));
  }
  const tmp = `${filePath}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(tmp, content, "utf-8");
  await fsp.rename(tmp, filePath);
}
