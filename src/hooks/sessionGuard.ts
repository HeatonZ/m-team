/**
 * M-Team Hooks — sessionGuard
 *
 * 限制心跳 session 调用危险工具（complete/fail）。
 * 限制 executor 调用只有 publisher 才能成功执行的 close。
 * 心跳 session 的 sessionKey 格式：agent:${agentId}:${channel}:heartbeat
 */

import type {
  OpenClawPluginApi,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
} from 'openclaw/plugin-sdk/core';

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
      ctx: PluginHookToolContext,
    ): PluginHookBeforeToolCallResult => {
      const { toolName, params } = event;
      const { sessionKey, agentId } = ctx;

      // 心跳 session 禁止调用 complete / fail（这两种由 agent_end hook 统一处理）
      if (
        (toolName === 'mteam_complete_task' || toolName === 'mteam_fail_task')
        && sessionKey?.endsWith(':heartbeat')
      ) {
        return {
          block: true,
          blockReason: `心跳 session（${sessionKey}）禁止调用 ${toolName}，请通过 relay 转移任务`,
        };
      }

      // close / reject / cancel：只有 publisher 才能成功执行
      // 拦截非 publisher 的调用（参数中 publisher 与调用者 agentId 不一致）
      if (
        (toolName === 'mteam_close_task' || toolName === 'mteam_reject_task' || toolName === 'mteam_cancel_task')
      ) {
        const callPublisher = (params as Record<string, unknown>).publisher as string | undefined;
        if (callPublisher && callPublisher !== agentId) {
          return {
            block: true,
            blockReason: `${toolName} 只能由任务发布者（publisher=${callPublisher}）调用，你（${agentId}）无权操作`,
          };
        }
      }

      return {};
    },
  );
}
