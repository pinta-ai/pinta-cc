"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateGuard = evaluateGuard;
const TIMEOUT_MS = 10_000;
// Self-identify to the manager's guard route so it can attribute calls to this
// adaptor (the route parses `pinta-*/<version>` out of the User-Agent). Keep the
// version in sync with package.json.
const GUARD_UA = 'pinta-cc/1.4.0';
function sleep(ms) {
    return new Promise((_, reject) => setTimeout(() => {
        const err = new Error('Guard request timed out');
        err.name = 'TimeoutError';
        reject(err);
    }, ms));
}
async function evaluateGuard(input, endpoint) {
    if (!endpoint)
        return null;
    if (process.env.PINTA_GUARD_DISABLED === '1')
        return null;
    const start = Date.now();
    try {
        const res = await Promise.race([
            fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'user-agent': GUARD_UA,
                    'x-pinta-relay-token': process.env.PINTA_RELAY_TOKEN ?? '',
                },
                body: JSON.stringify({ input }),
            }),
            sleep(TIMEOUT_MS),
        ]);
        if (res.status !== 200) {
            return { decision: 'ALLOW', reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: 'error' };
        }
        const body = (await res.json());
        return {
            decision: body.decision,
            reason: body.reason,
            userMessage: body.userMessage ?? null,
            durationMs: body.durationMs ?? (Date.now() - start),
        };
    }
    catch (err) {
        const reason = err.name === 'TimeoutError' ? 'timeout' : 'error';
        return { decision: 'ALLOW', reason: null, userMessage: null, durationMs: Date.now() - start, failOpenReason: reason };
    }
}
//# sourceMappingURL=guard.js.map