/**
 * Identity helpers for tool/hook caller resolution.
 *
 * OpenClaw may omit ctx.agentId in some execution paths.
 * We therefore fall back to parsing sessionKey when possible.
 */

export function normalizeAgentId(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export function parseAgentIdFromSessionKey(sessionKey: string | undefined | null): string | undefined {
  if (typeof sessionKey !== 'string') return undefined;
  const trimmed = sessionKey.trim();
  if (!trimmed.startsWith('agent:')) return undefined;

  const parts = trimmed.split(':');
  return normalizeAgentId(parts[1]);
}

export function resolveAgentIdFromContext(input: {
  agentId?: string | null;
  sessionKey?: string | null;
}): string | undefined {
  return normalizeAgentId(input.agentId) ?? parseAgentIdFromSessionKey(input.sessionKey);
}

export function resolvePublisherFromParamsAndContext(input: {
  publisher?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
}): string | undefined {
  return normalizeAgentId(input.publisher) ?? resolveAgentIdFromContext(input);
}
