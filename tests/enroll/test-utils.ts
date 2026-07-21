/**
 * Mirrors the pinta-manager sidecar's TokenSource resolver semantics
 * (`sidecar/src/enroll/relay.ts`) so ported enroll tests assert the exact
 * values the manager would inject.
 */
export function makeTokenResolver(opts: { sidecarPort: number; relayToken: string }) {
  return (source: string): string => {
    switch (source) {
      case "relay-endpoint":
        return `http://127.0.0.1:${opts.sidecarPort}/v1/traces`;
      case "relay-token":
        return `x-pinta-relay-token=${opts.relayToken}`;
      case "relay-token-raw":
        return opts.relayToken;
      case "relay-guard-endpoint":
        return `http://127.0.0.1:${opts.sidecarPort}/guard/evaluate`;
      default:
        throw new Error(`unknown token source: ${source}`);
    }
  };
}
