export interface GuardInput {
  spanId: string;
  toolName?: string;
  toolInput?: unknown;
  rawTextFields?: Record<string, string>;
}

export interface GuardResult {
  decision: 'ALLOW' | 'DENY' | 'REVIEW';
  reason: string | null;
  // Pre-formatted message the manager wants surfaced to the LLM/user when
  // decision === 'DENY'. Null otherwise, or when talking to an older manager
  // that doesn't yet emit this field.
  userMessage: string | null;
  durationMs: number;
  failOpenReason?: 'timeout' | 'refused' | 'error';
}

const TIMEOUT_MS = 50;

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => {
      const err = new Error('Guard request timed out');
      err.name = 'TimeoutError';
      reject(err);
    }, ms),
  );
}

export async function evaluateGuard(
  input: GuardInput,
  endpoint: string | undefined,
): Promise<GuardResult | null> {
  if (!endpoint) return null;
  if (process.env.PINTA_GUARD_DISABLED === '1') return null;
  const start = Date.now();
  try {
    const res = await Promise.race([
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pinta-relay-token': process.env.PINTA_RELAY_TOKEN ?? '',
        },
        body: JSON.stringify({ input }),
      }),
      sleep(TIMEOUT_MS),
    ]);
    if (res.status !== 200) {
      return { decision: 'ALLOW', reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: 'error' };
    }
    const body = (await res.json()) as {
      decision: GuardResult['decision'];
      reason: string | null;
      userMessage?: string | null;
      durationMs?: number;
    };
    return {
      decision: body.decision,
      reason: body.reason,
      userMessage: body.userMessage ?? null,
      durationMs: body.durationMs ?? (Date.now() - start),
    };
  } catch (err) {
    const reason: GuardResult['failOpenReason'] = (err as Error).name === 'TimeoutError' ? 'timeout' : 'error';
    return { decision: 'ALLOW', reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: reason };
  }
}
