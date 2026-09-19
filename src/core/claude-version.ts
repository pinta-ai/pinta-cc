import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PROBE_OUTPUT = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s+\(Claude Code\)$/m;
const PROBE_TIMEOUT_MS = 2_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 8;
const CACHE_FILE = "claude-version.json";

interface Executable {
  file: string;
  fingerprint: string;
}

interface CacheEntry {
  fingerprint: string;
  version: string | null;
  checkedAt: number;
}

const memoryCache = new Map<string, CacheEntry>();

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : "UNKNOWN";
}

function warn(reason: string): void {
  process.stderr.write(`[pinta-cc] CLI version: ${reason}\n`);
}

function missing(error: unknown): boolean {
  return codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR";
}

function findExecutable(): Executable | null {
  const explicit = process.env.CLAUDE_CODE_EXECPATH;
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  let candidates: string[];
  if (explicit) {
    candidates = [explicit];
  } else {
    const directories = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => path.isAbsolute(dir));
    try {
      directories.push(path.join(os.homedir(), ".local", "bin"));
    } catch (error) {
      warn(`native install directory lookup failed (${codeOf(error)})`);
    }
    candidates = directories.flatMap((dir) => names.map((name) => path.join(dir, name)));
  }

  for (const candidate of new Set(candidates)) {
    try {
      const file = fs.realpathSync(candidate);
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (!explicit && process.platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
      return {
        file,
        fingerprint: createHash("sha256")
          .update(JSON.stringify([file, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]))
          .digest("hex"),
      };
    } catch (error) {
      if (!missing(error)) warn(`executable lookup failed (${codeOf(error)})`);
    }
  }
  warn(explicit ? "configured executable is unavailable" : "no Claude executable found in PATH or ~/.local/bin");
  return null;
}

function packageVersion(file: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (!missing(error)) warn(`package metadata could not be read (${error instanceof SyntaxError ? "INVALID_JSON" : codeOf(error)})`);
    return null;
  }
  if (typeof value !== "object" || value === null || !("name" in value) || !("version" in value)) return null;
  if (typeof value.name !== "string" || typeof value.version !== "string" || !VERSION.test(value.version)) return null;
  return value.name === "@anthropic-ai/claude-code" || value.name.startsWith("@anthropic-ai/claude-code-")
    ? value.version
    : null;
}

function findPackageVersion(executable: string): string | null {
  let dir = path.dirname(executable);
  const binShim = path.basename(dir) === ".bin" && /^claude(?:\.cmd)?$/i.test(path.basename(executable));
  for (let depth = 0; depth < 6; depth++) {
    const version = packageVersion(path.join(dir, "package.json"));
    if (version) return version;
    // npm's Windows shim and pnpm's .bin launcher need not be symlinks.
    if (path.basename(executable).toLowerCase() === "claude.cmd" && depth === 0) {
      const shimVersion = packageVersion(path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "package.json"));
      if (shimVersion) return shimVersion;
    }
    if (binShim && path.basename(dir) === "node_modules") {
      const siblingVersion = packageVersion(path.join(dir, "@anthropic-ai", "claude-code", "package.json"));
      if (siblingVersion) return siblingVersion;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isEntry(value: unknown): value is CacheEntry {
  return typeof value === "object" && value !== null
    && "fingerprint" in value && typeof value.fingerprint === "string" && /^[0-9a-f]{64}$/.test(value.fingerprint)
    && "version" in value && (value.version === null || (typeof value.version === "string" && VERSION.test(value.version)))
    && "checkedAt" in value && typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt);
}

function fresh(entry: CacheEntry, now: number): boolean {
  const age = now - entry.checkedAt;
  return age >= 0 && age < (entry.version === null ? FAILURE_TTL_MS : CACHE_TTL_MS);
}

function readCache(directory: string | undefined): CacheEntry[] {
  if (!directory) return [];
  const file = path.join(directory, CACHE_FILE);
  try {
    if (fs.statSync(file).size > 16_384) {
      warn("oversized version cache ignored");
      return [];
    }
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(value) && value.length <= MAX_CACHE_ENTRIES && value.every(isEntry)) return value;
    warn("invalid version cache ignored");
  } catch (error) {
    if (!missing(error)) warn(`version cache read failed (${error instanceof SyntaxError ? "INVALID_JSON" : codeOf(error)})`);
  }
  return [];
}

function remember(entry: CacheEntry): void {
  memoryCache.delete(entry.fingerprint);
  memoryCache.set(entry.fingerprint, entry);
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
}

function writeCache(directory: string | undefined, entries: CacheEntry[]): void {
  if (!directory) return;
  const file = path.join(directory, CACHE_FILE);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(entries), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } catch (error) {
    warn(`version cache write failed (${codeOf(error)})`);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (!missing(error)) warn(`temporary version cache cleanup failed (${codeOf(error)})`);
    }
  }
}

function probeVersion(executable: string): string | null {
  // Never execute a Windows command shim through a shell.
  if (/\.(cmd|bat|ps1)$/i.test(executable)) {
    warn("command shim has no readable Claude package metadata");
    return null;
  }
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 4_096,
  });
  if (result.error || result.status !== 0) {
    warn(`version probe failed (${result.error ? codeOf(result.error) : `exit ${result.status ?? result.signal}`})`);
    return null;
  }
  const version = PROBE_OUTPUT.exec(result.stdout.trim())?.[1];
  if (version) return version;
  warn("version probe did not identify Claude Code");
  return null;
}

/** Resolves the product version, never the hook's Node or Pinta version. */
export function getClaudeCodeVersion(cacheDirectory?: string): string {
  const executable = findExecutable();
  if (!executable) return "unknown";
  // Read package metadata on each call so an npm upgrade cannot reuse an old cache.
  const fromPackage = findPackageVersion(executable.file);
  if (fromPackage) return fromPackage;

  const now = Date.now();
  const entries = readCache(cacheDirectory);
  const cached = [memoryCache.get(executable.fingerprint), ...entries]
    .find((entry) => entry && entry.fingerprint === executable.fingerprint && fresh(entry, now));
  if (cached) {
    remember(cached);
    return cached.version ?? "unknown";
  }

  const entry: CacheEntry = {
    fingerprint: executable.fingerprint,
    version: probeVersion(executable.file),
    checkedAt: Date.now(),
  };
  remember(entry);
  writeCache(cacheDirectory, [
    ...entries.filter((previous) => previous.fingerprint !== entry.fingerprint && fresh(previous, entry.checkedAt)),
    entry,
  ].slice(-MAX_CACHE_ENTRIES));
  return entry.version ?? "unknown";
}
