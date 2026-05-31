import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateGuard, type GuardResult } from '../../src/core/guard.js';

describe('evaluateGuard', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns null when PINTA_GUARD_ENDPOINT is unset (OSS path)', async () => {
    const r = await evaluateGuard({ spanId: 's', toolName: 'Bash', toolInput: 'echo' }, undefined);
    expect(r).toBeNull();
  });

  it('returns parsed decision on 200 (with userMessage)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({
        decision: 'DENY',
        reason: 'deny_credentials',
        userMessage: '⛔ Blocked by Pinta AI — deny_credentials',
        durationMs: 8,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as never;
    const r = await evaluateGuard(
      { spanId: 's', toolName: 'Bash', toolInput: 'echo $AWS' },
      'http://127.0.0.1:5147/guard/evaluate',
    );
    expect(r).toEqual<GuardResult>({
      decision: 'DENY',
      reason: 'deny_credentials',
      userMessage: '⛔ Blocked by Pinta AI — deny_credentials',
      durationMs: 8,
    });
  });

  it('tolerates older manager that omits userMessage (defaults to null)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ decision: 'DENY', reason: 'deny_credentials', durationMs: 8 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as never;
    const r = await evaluateGuard(
      { spanId: 's', toolName: 'Bash' },
      'http://127.0.0.1:5147/guard/evaluate',
    );
    expect(r?.userMessage).toBeNull();
  });

  it('returns fail-open on timeout', async () => {
    globalThis.fetch = vi.fn(async () => new Promise(() => {})) as never;
    const r = await evaluateGuard(
      { spanId: 's', toolName: 'Bash' },
      'http://127.0.0.1:5147/guard/evaluate',
    );
    expect(r?.decision).toBe('ALLOW');
    expect(r?.failOpenReason).toBe('timeout');
  });

  it('returns fail-open on non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as never;
    const r = await evaluateGuard({ spanId: 's', toolName: 'Bash' }, 'http://127.0.0.1:5147/guard/evaluate');
    expect(r?.decision).toBe('ALLOW');
    expect(r?.failOpenReason).toBe('error');
  });
});
