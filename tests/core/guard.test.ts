import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateGuard, type GuardResult } from '../../src/core/guard.js';
import { buildOtlpPayload } from '../../src/core/otlp.js';

vi.mock('../../src/core/claude-version.js', () => ({ getClaudeCodeVersion: () => '2.3.4' }));

/** The span PreToolUse is about to relay — what the guard is asked about. */
const payload = () =>
  buildOtlpPayload({
    event: {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      transcript_path: '/t',
      cwd: '/etc',
      tool_name: 'Bash',
      tool_input: { command: 'echo $AWS' },
      tool_use_id: 'u1',
    } as any,
    traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
  });

describe('evaluateGuard', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns null when PINTA_GUARD_ENDPOINT is unset (OSS path)', async () => {
    const r = await evaluateGuard(payload(), undefined);
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
    const r = await evaluateGuard(payload(), 'http://127.0.0.1:5147/guard/evaluate');
    // `clientRttMs` (core >=0.3.0) is this client's wall-clock for the call, so
    // it is measured, not echoed from the response body — match it by type.
    expect(r).toEqual<GuardResult>({
      decision: 'DENY',
      reason: 'deny_credentials',
      userMessage: '⛔ Blocked by Pinta AI — deny_credentials',
      durationMs: 8,
      clientRttMs: expect.any(Number),
    });
  });

  /**
   * The body is the OTLP payload itself — no `{input}` envelope, nothing
   * re-read out of the event by hand. The manager projects it through the
   * same AgentEvent assembly the backend stores it with (core >=0.8.0), so
   * `cc.cwd` and `cc.hook` reach the guard as span attributes rather than as
   * fields a handler remembered to copy (PTA-176 · PTA-207).
   */
  it('sends the span it was given as the body, unwrapped', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ decision: 'ALLOW', reason: null, durationMs: 1 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    globalThis.fetch = fetchMock as never;
    const p = payload();
    await evaluateGuard(p, 'http://127.0.0.1:5147/guard/evaluate');
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(sent).toEqual(p);
    expect('input' in sent).toBe(false);
    const attrs = Object.fromEntries(
      sent.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a: any) => [a.key, a.value.stringValue]),
    );
    expect(attrs).toMatchObject({ 'ingest.type': 'cc', 'cc.hook': 'PreToolUse', 'cc.cwd': '/etc', 'cc.tool_name': 'Bash' });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^pinta-cc\//);
  });

  it('tolerates older manager that omits userMessage (defaults to null)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ decision: 'DENY', reason: 'deny_credentials', durationMs: 8 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as never;
    const r = await evaluateGuard(payload(), 'http://127.0.0.1:5147/guard/evaluate');
    expect(r?.userMessage).toBeNull();
  });

  it('returns fail-open on timeout', async () => {
    vi.useFakeTimers();
    try {
      // core >=0.5.0 aborts the fetch via AbortController on timeout, so the
      // mock must reject on signal abort — a never-settling promise would hang.
      globalThis.fetch = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ) as never;
      const p = evaluateGuard(payload(), 'http://127.0.0.1:5147/guard/evaluate');
      await vi.advanceTimersByTimeAsync(10_000);
      const r = await p;
      expect(r?.decision).toBe('ALLOW');
      expect(r?.failOpenReason).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns fail-open on non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as never;
    const r = await evaluateGuard(payload(), 'http://127.0.0.1:5147/guard/evaluate');
    expect(r?.decision).toBe('ALLOW');
    expect(r?.failOpenReason).toBe('error');
  });

  /**
   * A manager that has stopped accepting what this build sends answers 410,
   * and that is recorded apart from an outage: `refused`, not `error`. From a
   * build on core 0.8.0 it can only mean a hand-assembled or forked request.
   */
  it('records a 410 from the manager as failOpenReason=refused', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'legacy_guard_input' }), { status: 410 })) as never;
    const r = await evaluateGuard(payload(), 'http://127.0.0.1:5147/guard/evaluate');
    expect(r?.decision).toBe('ALLOW');
    expect(r?.failOpenReason).toBe('refused');
  });
});
