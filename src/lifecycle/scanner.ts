/**
 * A2 — pinta-cc `TranscriptSource` implementation for `~/.claude/projects`.
 *
 * Real-world shape observed on disk (plan §4.3, §3.1):
 *   <projectsRoot>/<projectKey>/<sessionId>.jsonl                  (top-level session log)
 *   <projectsRoot>/<projectKey>/<sessionId>/subagents/*.jsonl      (nested, same session)
 *   <projectsRoot>/<projectKey>/<sessionId>/subagents/*.meta.json  (nested metadata)
 *   <projectsRoot>/<projectKey>/memory/*.md                       (no sessionId)
 *
 * No exclusion rules for CC — everything under the root is a candidate
 * (plan §2 "업로드 범위" + §4.3 "제외 규칙: 없음 (전부)").
 *
 * Per plan §4.2, the lifecycle module sticks to `node:*` APIs only (no Bun-
 * specific globals) so it runs unmodified whether the sidecar host is Node
 * or Bun.
 */
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  TranscriptClass,
  TranscriptFile,
  TranscriptSemantics,
  TranscriptSource,
} from "./types.js";

const WRAPPER_ID = "pinta-cc";

/** Directory name under a project that holds non-session notes (no sessionId). */
const MEMORY_DIR = "memory";

/** `$CLAUDE_CONFIG_DIR ?? ~/.claude` — same override Claude Code itself honors. */
function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.length > 0) {
    return override;
  }
  return path.join(homedir(), ".claude");
}

function projectsRoot(): string {
  return path.join(claudeConfigDir(), "projects");
}

/** Relative path from `root` to `absPath`, POSIX-style (`/` separators) regardless of platform. */
function toPosixRelPath(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function semanticsFor(relPath: string): TranscriptSemantics {
  // No databases in CC (plan §4.3): *.jsonl append-logs, everything else is
  // treated as a wholesale rewrite (memory/*.md, subagent *.meta.json, ...).
  return relPath.endsWith(".jsonl") ? "append-log" : "rewritten-doc";
}

/**
 * Derives `projectKey`/`sessionId` from a projects-root-relative path.
 *
 * - `<proj>/<sessionId>.jsonl`        -> { projectKey: proj, sessionId }
 * - `<proj>/<sessionId>/**`           -> { projectKey: proj, sessionId } (e.g. subagents/*)
 * - `<proj>/memory/**`                -> { projectKey: proj }            (no sessionId)
 * - `<proj>/<other top-level file>`   -> { projectKey: proj }            (no sessionId)
 */
function sessionInfoFor(relPath: string): Pick<TranscriptFile, "projectKey" | "sessionId"> {
  const segments = relPath.split("/");
  if (segments.length < 2) {
    // A file directly under the projects root, outside any project dir —
    // not expected in practice, but don't crash on it.
    return {};
  }

  const projectKey = segments[0];
  const second = segments[1];

  if (segments.length === 2) {
    // Top-level file within the project dir: <proj>/<second>
    if (second.endsWith(".jsonl")) {
      return { projectKey, sessionId: second.slice(0, -".jsonl".length) };
    }
    return { projectKey };
  }

  // Nested: <proj>/<second>/**
  if (second === MEMORY_DIR) {
    return { projectKey };
  }
  return { projectKey, sessionId: second };
}

/** `classify()` — coarse content type from `relPath` alone (plan §4.2). */
export function classify(relPath: string): TranscriptClass {
  if (relPath.endsWith(".jsonl")) {
    return "session-log";
  }
  const segments = relPath.split("/");
  if (segments[1] === MEMORY_DIR) {
    return "memory";
  }
  if (relPath.endsWith(".json")) {
    return "meta";
  }
  return "other";
}

export async function roots(): Promise<string[]> {
  return [projectsRoot()];
}

/**
 * Recursive, streaming walk of `dir` yielding every *file* found (never
 * directories), depth-first. Uses `opendir`'s own async iteration rather
 * than `readdir` so we never materialize a full directory listing (or the
 * whole tree) in memory at once — the corpus is 77 projects / 887 files /
 * 288MB and growing (plan §3.1).
 */
async function* walkFiles(root: string, dir: string): AsyncGenerator<{ absPath: string; relPath: string }> {
  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    // Root doesn't exist yet (fresh install, no sessions recorded) or
    // vanished mid-walk (deleted project) — nothing to yield.
    return;
  }

  try {
    for await (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkFiles(root, absPath);
      } else if (entry.isFile()) {
        yield { absPath, relPath: toPosixRelPath(root, absPath) };
      }
      // Symlinks and other special entries are skipped — CC does not
      // produce them under `projects/`, and following them risks escaping
      // the root or cycles.
    }
  } catch {
    // Directory removed while we were iterating it — treat as end of
    // stream for this subtree rather than failing the whole scan.
    return;
  }
}

async function* scan(opts: { since?: Date }): AsyncIterable<TranscriptFile> {
  const [root] = await roots();
  const sinceMs = opts.since?.getTime();

  for await (const { absPath, relPath } of walkFiles(root, root)) {
    let st;
    try {
      st = await stat(absPath);
    } catch {
      // Removed between listing and stat (TOCTOU) — skip, next cycle will
      // simply not see it either (plan §4.1 "삭제됨: 스킵").
      continue;
    }

    if (sinceMs !== undefined && st.mtime.getTime() <= sinceMs) {
      continue;
    }

    const { projectKey, sessionId } = sessionInfoFor(relPath);

    yield {
      relPath,
      absPath,
      size: st.size,
      mtime: st.mtime,
      sessionId,
      projectKey,
      semantics: semanticsFor(relPath),
    };
  }
}

export const lifecycle: TranscriptSource = {
  id: WRAPPER_ID,
  roots,
  scan,
  classify,
  // No `snapshot()` — CC has no database-semantics files (plan §4.3).
};
