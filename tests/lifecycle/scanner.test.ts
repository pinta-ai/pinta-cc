import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { lifecycle, classify } from "../../src/lifecycle/scanner";
import type { TranscriptFile } from "../../src/lifecycle/types";

const SAVED_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

const PROJECT = "myproj";
const SESSION_ID = "sess-abc123";

let tmpRoot: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pinta-cc-lifecycle-"));
}

function write(relPath: string, content = ""): string {
  const abs = path.join(tmpRoot, "projects", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Builds the fixture tree described in the task:
 *   <proj>/<uuid>.jsonl
 *   <proj>/<uuid>/subagents/agent-1.jsonl
 *   <proj>/<uuid>/subagents/agent-1.meta.json
 *   <proj>/memory/MEMORY.md
 *   <proj>/memory/notes.md
 */
function buildFixture(): void {
  write(`${PROJECT}/${SESSION_ID}.jsonl`, '{"type":"session-start"}\n');
  write(`${PROJECT}/${SESSION_ID}/subagents/agent-1.jsonl`, '{"type":"subagent"}\n');
  write(`${PROJECT}/${SESSION_ID}/subagents/agent-1.meta.json`, '{"agent":"agent-1"}');
  write(`${PROJECT}/memory/MEMORY.md`, "# memory\n");
  write(`${PROJECT}/memory/notes.md`, "notes\n");
}

async function collect(iter: AsyncIterable<TranscriptFile>): Promise<Map<string, TranscriptFile>> {
  const out = new Map<string, TranscriptFile>();
  for await (const file of iter) {
    out.set(file.relPath, file);
  }
  return out;
}

beforeEach(() => {
  tmpRoot = makeTmpDir();
  process.env.CLAUDE_CONFIG_DIR = tmpRoot;
  buildFixture();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (SAVED_CLAUDE_CONFIG_DIR === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = SAVED_CLAUDE_CONFIG_DIR;
  }
});

describe("lifecycle.id / roots()", () => {
  it("id is 'pinta-cc'", () => {
    expect(lifecycle.id).toBe("pinta-cc");
  });

  it("roots() resolves to $CLAUDE_CONFIG_DIR/projects", async () => {
    const roots = await lifecycle.roots();
    expect(roots).toEqual([path.join(tmpRoot, "projects")]);
  });
});

describe("scan() — POSIX relPaths, semantics, sessionId, projectKey", () => {
  it("yields every file in the fixture tree with POSIX-style relPaths", async () => {
    const files = await collect(lifecycle.scan({}));
    expect(new Set(files.keys())).toEqual(
      new Set([
        `${PROJECT}/${SESSION_ID}.jsonl`,
        `${PROJECT}/${SESSION_ID}/subagents/agent-1.jsonl`,
        `${PROJECT}/${SESSION_ID}/subagents/agent-1.meta.json`,
        `${PROJECT}/memory/MEMORY.md`,
        `${PROJECT}/memory/notes.md`,
      ]),
    );
    for (const relPath of files.keys()) {
      expect(relPath).not.toContain("\\");
    }
  });

  it("classifies *.jsonl (top-level and nested) as append-log, everything else as rewritten-doc", async () => {
    const files = await collect(lifecycle.scan({}));
    expect(files.get(`${PROJECT}/${SESSION_ID}.jsonl`)!.semantics).toBe("append-log");
    expect(files.get(`${PROJECT}/${SESSION_ID}/subagents/agent-1.jsonl`)!.semantics).toBe("append-log");
    expect(files.get(`${PROJECT}/${SESSION_ID}/subagents/agent-1.meta.json`)!.semantics).toBe("rewritten-doc");
    expect(files.get(`${PROJECT}/memory/MEMORY.md`)!.semantics).toBe("rewritten-doc");
    expect(files.get(`${PROJECT}/memory/notes.md`)!.semantics).toBe("rewritten-doc");
  });

  it("tags projectKey on every file under the project dir", async () => {
    const files = await collect(lifecycle.scan({}));
    for (const file of files.values()) {
      expect(file.projectKey).toBe(PROJECT);
    }
  });

  it("propagates sessionId from the top-level <sess>.jsonl to nested <sess>/subagents/** files", async () => {
    const files = await collect(lifecycle.scan({}));
    expect(files.get(`${PROJECT}/${SESSION_ID}.jsonl`)!.sessionId).toBe(SESSION_ID);
    expect(files.get(`${PROJECT}/${SESSION_ID}/subagents/agent-1.jsonl`)!.sessionId).toBe(SESSION_ID);
    expect(files.get(`${PROJECT}/${SESSION_ID}/subagents/agent-1.meta.json`)!.sessionId).toBe(SESSION_ID);
  });

  it("does not tag a sessionId on files under memory/**", async () => {
    const files = await collect(lifecycle.scan({}));
    expect(files.get(`${PROJECT}/memory/MEMORY.md`)!.sessionId).toBeUndefined();
    expect(files.get(`${PROJECT}/memory/notes.md`)!.sessionId).toBeUndefined();
  });

  it("absPath round-trips to a real, readable file", async () => {
    const files = await collect(lifecycle.scan({}));
    const file = files.get(`${PROJECT}/${SESSION_ID}.jsonl`)!;
    expect(fs.existsSync(file.absPath)).toBe(true);
    expect(file.size).toBeGreaterThan(0);
  });
});

describe("scan({ since }) — mtime filtering", () => {
  it("only yields files with mtime strictly after `since`", async () => {
    const allBefore = await collect(lifecycle.scan({}));
    const cutoff = new Date();

    // Push every existing fixture file's mtime behind the cutoff.
    for (const file of allBefore.values()) {
      const past = new Date(cutoff.getTime() - 60_000);
      fs.utimesSync(file.absPath, past, past);
    }

    // One file touched after the cutoff.
    const freshRelPath = `${PROJECT}/memory/notes.md`;
    const freshAbsPath = path.join(tmpRoot, "projects", freshRelPath);
    const future = new Date(cutoff.getTime() + 60_000);
    fs.utimesSync(freshAbsPath, future, future);

    const filtered = await collect(lifecycle.scan({ since: cutoff }));
    expect(Array.from(filtered.keys())).toEqual([freshRelPath]);
  });

  it("yields nothing when since is after every file's mtime", async () => {
    const farFuture = new Date(Date.now() + 3600_000);
    const filtered = await collect(lifecycle.scan({ since: farFuture }));
    expect(filtered.size).toBe(0);
  });

  it("yields everything when since is omitted", async () => {
    const filtered = await collect(lifecycle.scan({}));
    expect(filtered.size).toBe(5);
  });
});

describe("classify()", () => {
  it("classifies top-level and nested *.jsonl as session-log", () => {
    expect(classify(`${PROJECT}/${SESSION_ID}.jsonl`)).toBe("session-log");
    expect(classify(`${PROJECT}/${SESSION_ID}/subagents/agent-1.jsonl`)).toBe("session-log");
  });

  it("classifies memory/** as memory", () => {
    expect(classify(`${PROJECT}/memory/MEMORY.md`)).toBe("memory");
    expect(classify(`${PROJECT}/memory/notes.md`)).toBe("memory");
  });

  it("classifies non-jsonl *.json metadata as meta", () => {
    expect(classify(`${PROJECT}/${SESSION_ID}/subagents/agent-1.meta.json`)).toBe("meta");
  });

  it("classifies anything else as other", () => {
    expect(classify(`${PROJECT}/${SESSION_ID}/subagents/agent-1.log`)).toBe("other");
  });

  it("is also reachable as lifecycle.classify", () => {
    expect(lifecycle.classify?.(`${PROJECT}/memory/notes.md`)).toBe("memory");
  });
});
