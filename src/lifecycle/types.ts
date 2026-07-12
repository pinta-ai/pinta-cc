// TODO(A4): replace with import from @pinta-ai/core@^0.4.0
//
// This mirrors, verbatim, the `TranscriptSource` contract frozen in
// pinta-manager's docs/features/v0.1.9/USER_TRANSCRIPT_CRAWL_DIFF_PLAN.md
// §4.2 (WP CT1). pinta-core@0.4.0 will ship this as `src/lifecycle.ts` (WP
// A1, in flight in parallel); until that lands, pinta-cc vendors an
// identical copy so the A2 scanner has a contract to implement against. Do
// NOT diverge from the plan's shape here — when @pinta-ai/core@^0.4.0 is
// available, this file is deleted and imports are repointed (A4).

/**
 * How a transcript file's on-disk history behaves, which determines the
 * incremental upload strategy the sidecar applies (plan §4.2 table):
 * - `append-log`: prefix-stable growth (e.g. `.jsonl` session logs) — tail-only upload.
 * - `rewritten-doc`: rewritten wholesale on save (e.g. json/yaml/pbtxt) — full-file
 *   upload only when its content hash changes.
 * - `database`: live SQLite (or similar) file — must go through `snapshot()`
 *   before reading (torn-read risk), then full-file upload on hash change.
 */
export type TranscriptSemantics = "append-log" | "rewritten-doc" | "database";

export interface TranscriptFile {
  relPath: string;
  absPath: string;
  size: number;
  mtime: Date;
  sessionId?: string;
  projectKey?: string;
  semantics: TranscriptSemantics;
}

/**
 * Coarse content classification a wrapper can attach to a `relPath`, purely
 * informational for now (dashboards / future exclusion or masking policy —
 * see plan §6 "memory/*.md 등 비세션 파일").
 */
export type TranscriptClass = "session-log" | "meta" | "memory" | "other";

// pinta-core (신규 모듈 src/lifecycle.ts)
export interface TranscriptSource {
  id: string; // 'pinta-cc'
  roots(): Promise<string[]>; // ['~/.claude/projects']
  scan(opts: { since?: Date }): AsyncIterable<TranscriptFile>;
  classify?(relPath: string): TranscriptClass;
  // 'database' 파일(SQLite 등)의 정합 스냅샷 획득 (backup API / VACUUM INTO).
  // 반환된 임시 파일을 업로드 후 삭제. 미구현이면 해당 파일 스킵 + audit.
  snapshot?(file: TranscriptFile): Promise<string /* tmp absPath */>;
}
