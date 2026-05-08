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
      const isExecutorTaskSession = Boolean(sessionKey?.startsWith(`agent:${agentId}:m-team:task_`));

      // 心跳 session 禁止调用 complete / fail（这两种由 subagent_ended hook 统一处理）
      if (
        (toolName === 'mteam_complete_task' || toolName === 'mteam_fail_task')
        && sessionKey?.endsWith(':heartbeat')
      ) {
        return {
          block: true,
          blockReason: `心跳 session（${sessionKey}）禁止调用 ${toolName}，请通过 relay 转移任务`,
        };
      }

      // 心跳 session 禁止发布新任务（publish 应由 executor 主动完成后触发，或 manager 主动发布）
      if (toolName === 'mteam_publish_task' && sessionKey?.endsWith(':heartbeat')) {
        return {
          block: true,
          blockReason: `心跳 session（${sessionKey}）禁止发布新任务`,
        };
      }

      // executor task session 禁止主动 relinquish 当前任务。
      // 正常交接应由 subagent_ended hook 在 executor 结束后统一判断 relay/complete；
      // executor 提前 relinquish 会把任务改成 pending，导致 subagent_ended relay 失败（TASK_NOT_RUNNING_pending）。
      if (toolName === 'mteam_relinquish_task' && isExecutorTaskSession) {
        return {
          block: true,
          blockReason: `executor session（${sessionKey}）禁止主动调用 mteam_relinquish_task。请完成当前步骤后直接结束 session，由 subagent_ended hook 自动 relay/complete。`,
        };
      }

      // publish：只有配置中的 publishers 才能发布任务
      if (toolName === 'mteam_publish_task' && !publishers.has(agentId)) {
        return {
          block: true,
          blockReason: `mteam_publish_task 只能由 publishers 配置中的 agent 调用，你（${agentId}）不在 publishers 列表中`,
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
