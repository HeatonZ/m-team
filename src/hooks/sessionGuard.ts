/**
 * M-Team hook: session guard.
 *
 * Guardrails:
 * - Block risky tool calls in heartbeat sessions.
 * - Block executor task sessions from forcing next/relinquish manually.
 * - Restrict publish and publisher terminal actions.
 */

import type {
  OpenClawPluginApi,
} from 'openclaw/plugin-sdk/core';
import type {
  OpenClawPluginToolContext,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
} from '../types/openclaw-hooks.js';

interface RegisterOptions {
  publishers: string[];
}

export function registerSessionGuardHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const publishers = new Set(options.publishers ?? []);

  api.on(
    'before_tool_call',
    (
      event: PluginHookBeforeToolCallEvent,
      ctx: OpenClawPluginToolContext,
    ): PluginHookBeforeToolCallResult => {
      const { toolName, params } = event;
      const { sessionKey, agentId } = ctx;
      const isExecutorTaskSession = Boolean(sessionKey?.startsWith(`agent:${agentId}:m-team:task_`));
      const isHeartbeatSession = Boolean(sessionKey?.endsWith(':heartbeat'));

      if (
        isHeartbeatSession
        && (
          toolName === 'mteam_complete_task'
          || toolName === 'mteam_fail_task'
          || toolName === 'mteam_next_task'
          || toolName === 'sessions_spawn'
          || toolName === 'sessions_send'
        )
      ) {
        return {
          block: true,
          blockReason: `Heartbeat session (${sessionKey}) cannot call ${toolName}. Heartbeat only handles claim/publisher acceptance.`,
        };
      }

      if (toolName === 'mteam_publish_task' && isHeartbeatSession) {
        return {
          block: true,
          blockReason: `Heartbeat session (${sessionKey}) cannot publish new tasks.`,
        };
      }

      if (toolName === 'mteam_relinquish_task' && isExecutorTaskSession) {
        return {
          block: true,
          blockReason: `Executor session (${sessionKey}) cannot call mteam_relinquish_task. End session and let agent_end decide.`,
        };
      }

      if (toolName === 'mteam_next_task' && isExecutorTaskSession) {
        return {
          block: true,
          blockReason: `Executor session (${sessionKey}) cannot call mteam_next_task. End session and let agent_end decide.`,
        };
      }

      if (toolName === 'mteam_publish_task' && (!agentId || !publishers.has(agentId))) {
        return {
          block: true,
          blockReason: `mteam_publish_task is restricted to configured publishers. agent=${agentId ?? 'unknown'} is not allowed.`,
        };
      }

      if (
        toolName === 'mteam_close_task'
        || toolName === 'mteam_reject_task'
        || toolName === 'mteam_cancel_task'
      ) {
        const callPublisher = (params as Record<string, unknown>).publisher as string | undefined;
        if (callPublisher && callPublisher !== agentId) {
          return {
            block: true,
            blockReason: `${toolName} 无权操作: only task publisher can call this tool. publisher=${callPublisher}, agent=${agentId ?? 'unknown'}.`,
          };
        }
      }

      return {};
    },
  );
}
