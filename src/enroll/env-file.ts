// Ported verbatim from pinta-manager `sidecar/src/enroll/env-file.ts`.
// (Distinct from `src/env-file.ts`, the hook-runtime loader binding over
// @pinta-ai/core — this one is the enroll-time parser/serializer pair with
// the manager's exact merge semantics.)

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Serialize a key/value map as a `KEY=VALUE` env file. Values are NOT escaped —
 * tokens containing `=` or newline will corrupt re-parsing. The relay TokenSource
 * resolver only produces base-URLs and OTel header strings, both of which are
 * safe; new TokenSource variants must keep this invariant.
 */
export function serializeEnvFile(values: Record<string, string>): string {
  return Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}
