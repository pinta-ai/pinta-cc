import { describe, it, expect } from 'vitest';
import { buildOtlpPayload } from '../../src/core/otlp';

describe('buildOtlpPayload (v1.2.0 — generic)', () => {
  it('produces resourceSpans with one span per call', () => {
    const payload = buildOtlpPayload({
      event: {
        hook_event_name: 'SessionStart',
        session_id: 'sess-123',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/tmp',
      } as any,
      traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
    });
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('cc.session_start');
  });

  it('flattens hook event fields into cc.* attributes', () => {
    const payload = buildOtlpPayload({
      event: {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        transcript_path: '/t',
        cwd: '/t',
        tool_name: 'Bash',
      } as any,
      traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
    });
    const attrs = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    const hook = attrs.find((a: any) => a.key === 'cc.hook');
    expect((hook?.value as any)?.stringValue).toBe('PreToolUse');
  });

  it('does NOT include member.identity.* in resource attributes', () => {
    const payload = buildOtlpPayload({
      event: { hook_event_name: 'Stop', session_id: 's', transcript_path: '/t', cwd: '/t' } as any,
      traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
    });
    const resourceAttrs = payload.resourceSpans[0].resource.attributes;
    expect(resourceAttrs.find((a: any) => a.key === 'member.identity.id')).toBeUndefined();
    expect(resourceAttrs.find((a: any) => a.key === 'member.identity.email')).toBeUndefined();
  });

  it('reports service.name = claude-code', () => {
    const payload = buildOtlpPayload({
      event: { hook_event_name: 'SessionStart', session_id: 's', transcript_path: '/t', cwd: '/t' } as any,
      traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
    });
    const resourceAttrs = payload.resourceSpans[0].resource.attributes;
    const sn = resourceAttrs.find((a: any) => a.key === 'service.name');
    expect((sn?.value as any)?.stringValue).toBe('claude-code');
  });

  it('emits pinta.guard.* attributes when guard result is provided', () => {
    const payload = buildOtlpPayload({
      event: {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        transcript_path: '/t',
        cwd: '/t',
        tool_name: 'Bash',
        tool_input: {},
        tool_use_id: 'u1',
      } as any,
      traceId: '01HQXM7Y9YZJ8MK7Z6P3X1V8R0',
      guard: { decision: 'DENY', reason: 'deny_credentials', userMessage: '⛔ Blocked by Pinta AI — deny_credentials', durationMs: 8 },
    });
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    const decision = span.attributes.find((a: any) => a.key === 'pinta.guard.decision');
    const rule = span.attributes.find((a: any) => a.key === 'pinta.guard.matched_rule');
    const dur = span.attributes.find((a: any) => a.key === 'pinta.guard.duration_ms');
    expect((decision?.value as any)?.stringValue).toBe('deny');
    expect((rule?.value as any)?.stringValue).toBe('deny_credentials');
    expect((dur?.value as any)?.intValue).toBe(8);
  });
});
