/**
 * M-Team Hooks — agent_end handler
 *
 * 观察 agent turn 结束时的消息列表、success 状态、durationMs。
 * 目前仅打印日志，用于确认 executor session 是否会触发此 hook，
 * 以及 event 中是否包含足够的上下文（如 sessionKey 能否解析出 taskId）。
 */

import type {
  OpenClawPluginApi,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
} from 'openclaw/plugin-sdk/core';

export function registerAgentEndHook(api: OpenClawPluginApi): void {
  api.on('agent_end', async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    const { runId, messages, success, error, durationMs } = event;
    const { sessionKey, sessionId, agentId, runId: ctxRunId } = ctx;
    api.logger?.info(`hook agent_end ${sessionKey}`)
    // 尝试从 sessionKey 解析 taskId（格式: agent:{agentId}:m-team:{taskId}）
    let taskId: string | null = null;
    if (sessionKey?.startsWith('agent:')) {
      const parts = sessionKey.split(':');
      // parts[0]=agent, parts[1]=agentId, parts[2]=m-team, parts[3]=taskId
      if (parts[2] === 'm-team' && parts[3]) {
        taskId = parts[3];
      }
    }

    api.logger?.info(
      `[m-team] agent_end | ` +
        `sessionKey=${sessionKey ?? 'n/a'} | ` +
        `sessionId=${sessionId ?? 'n/a'} | ` +
        `agentId=${agentId ?? 'n/a'} | ` +
        `runId=${runId ?? ctxRunId ?? 'n/a'} | ` +
        `taskId=${taskId ?? 'n/a'} | ` +
        `success=${success} | ` +
        `durationMs=${durationMs ?? 'n/a'} | ` +
        `error=${error ?? 'none'} | ` +
        `messages=${messages?.length ?? 0}条`
    );

    // 打印最后几条消息的摘要（方便调试）
    if (messages && messages.length > 0) {
      const summary = messages.slice(-3).map((m: unknown) => {
        const msg = m as Record<string, unknown>;
        const role = msg.role ?? 'unknown';
        const content = Array.isArray(msg.content)
          ? msg.content.map((c: unknown) => {
              const block = c as Record<string, unknown>;
              return block.type === 'text' ? (block.text as string).slice(0, 80) : block.type;
            }).join('|')
          : String(msg.content ?? '').slice(0, 80);
        return `${role}:${content}`;
      }).join(' || ');
      api.logger?.info(`[m-team] agent_end messages summary: ${summary}`);
    }
  });
}
