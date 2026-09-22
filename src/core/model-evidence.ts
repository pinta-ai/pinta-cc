import fs from "node:fs";
import path from "node:path";

export type RecordValue = Record<string, unknown>;
export interface ModelEvidence {
  name: string;
  source: string;
}

const PLACEHOLDERS = new Set(["", "unknown", "undefined", "null", "n/a", "none", "auto", "default"]);
export const TRANSCRIPT_PREFIX_BYTES = 256 * 1024;
export const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const MAX_RECORDS = 4096;

export function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue : undefined;
}

export function modelName(value: unknown): string | undefined {
  const descriptor = record(value);
  const scalar = descriptor ? ("id" in descriptor ? descriptor.id : descriptor.name) : value;
  if (typeof scalar !== "string") return undefined;
  const name = scalar.trim();
  if (name.startsWith("{") || name.startsWith("[")) return undefined;
  return name.length <= 512 && !/[\u0000-\u001f\u007f]/.test(name)
    && !PLACEHOLDERS.has(name.toLowerCase()) ? name : undefined;
}

export function applyModelEvidence(fields: RecordValue, model: ModelEvidence | undefined): void {
  delete fields.model;
  if (!model) return;
  fields.model = model.name;
  if (model.source === "hook.model" && fields.model_source !== undefined) return;
  if (fields.model_source !== undefined) fields.model_original_source = fields.model_source;
  fields.model_source = model.source;
}

export function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)
    ? value : undefined;
}

export function timestamp(value: unknown): number | undefined {
  const ms = typeof value === "number" ? value
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

export function eventTime(event: RecordValue, now: number): number | undefined {
  const time = event.timestamp === undefined ? timestamp(now) : timestamp(event.timestamp);
  return time !== undefined && time <= now ? time : undefined;
}

interface Transcript {
  first?: RecordValue;
  rows: RecordValue[];
  complete: boolean;
}

/** A fixed snapshot, not a cache: hooks run in fresh processes and models can change. */
export function readTranscript(file: unknown): Transcript | undefined {
  if (typeof file !== "string" || file.length > 4096 || /[\u0000-\u001f]/.test(file)
    || !path.isAbsolute(file) || path.extname(file) !== ".jsonl") return undefined;
  let fd: number | undefined;
  try {
    // Nonblocking open + regular-file check also make FIFOs/devices harmless.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size <= 0) return undefined;
    const prefix = Buffer.alloc(Math.min(stat.size, TRANSCRIPT_PREFIX_BYTES));
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) return undefined;
    const firstNewline = prefix.indexOf(10);
    let first: RecordValue | undefined;
    if (firstNewline >= 0) {
      try { first = record(JSON.parse(prefix.toString("utf8", 0, firstNewline))); } catch { /* unavailable header */ }
    }
    const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_BYTES);
    const tail = stat.size <= prefix.length ? prefix : Buffer.alloc(stat.size - start);
    if (tail !== prefix && fs.readSync(fd, tail, 0, tail.length, start) !== tail.length) return undefined;
    const after = fs.fstatSync(fd);
    if (after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs)) return undefined;

    // Discard boundary fragments, even a parseable last line: it may still be being appended.
    const begin = start > 0 ? tail.indexOf(10) + 1 : 0;
    let end = tail.lastIndexOf(10);
    if ((start > 0 && begin === 0) || end < begin) return undefined;
    const rows: RecordValue[] = [];
    let lines = 0;
    while (end > begin && lines < MAX_RECORDS) {
      const previous = tail.lastIndexOf(10, end - 1);
      const lineStart = Math.max(begin, previous + 1);
      const line = tail.toString("utf8", lineStart, end).trim();
      if (line) {
        const parsed = record(JSON.parse(line));
        if (parsed) rows.push(parsed);
      }
      end = lineStart - 1;
      lines++;
    }
    rows.reverse();
    return { first, rows, complete: start === 0 && end < 0 && tail[tail.length - 1] === 10 };
  } catch {
    // Never log paths or transcript contents, and never let enrichment fail a hook.
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

export function consensus(candidates: Array<ModelEvidence | undefined>): ModelEvidence | undefined {
  const first = candidates[0];
  return first && candidates.every((candidate) => candidate?.name === first.name) ? first : undefined;
}
