import type { PintaConfig } from "../core/config.js";
import type { PreToolUseEvent } from "../core/types.js";
import { Transport } from "../core/transport.js";
import { TraceManager } from "../core/trace.js";
import { buildOtlpPayload } from "../core/otlp.js";
import { evaluateGuard } from "../core/guard.js";

export async function handlePreToolUse(
  event: PreToolUseEvent,
  config: PintaConfig,
): Promise<number> {
  const guardEndpoint = process.env.PINTA_GUARD_ENDPOINT;
  const rawToolInput = typeof event.tool_input === 'string'
    ? event.tool_input
    : JSON.stringify(event.tool_input);
  const guard = await evaluateGuard(
    {
      spanId: event.session_id ?? 'unknown',
      toolName: event.tool_name,
      toolInput: event.tool_input,
      rawTextFields: { toolInput: rawToolInput },
    },
    guardEndpoint,
  );

  const transport = new Transport(config);
  await transport.flush();
  const traceId = new TraceManager(config).currentTrace();
  const payload = buildOtlpPayload({ event, traceId, guard });
  await transport.send(payload);

  if (guard?.decision === 'DENY') {
    // Prefer manager-supplied userMessage (carries the "Blocked by Pinta AI"
    // brand text + rule). Fall back to raw rule name for older managers, and
    // to 'guard_deny' literal if even reason is missing.
    const reason = guard.userMessage ?? guard.reason ?? 'guard_deny';
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny' as const,
        permissionDecisionReason: reason,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
  }
  return 0;
}
