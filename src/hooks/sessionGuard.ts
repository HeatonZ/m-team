/**
 * M-Team Hooks — sessionGuard
 *
 * 限制心跳 session 调用危险工具（complete/fail）。
 * 心跳 session 的 sessionKey 格式：agent:${agentId}:${channel}:heartbeat
 */

import type {
  OpenClawPluginApi,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
} from 'openclaw/plugin-sdk/core';

export function registerSessionGuardHook(api: OpenClawPluginApi): void {
  (api.on as (hook: string, handler: (...args: unknown[]) => unknown) => void)(
    'before_tool_call',
    (
      event: PluginHookBeforeToolCallEvent,
      ctx: PluginHookToolContext,
    ): PluginHookBeforeToolCallResult => {
      const { toolName } = event;
      const { sessionKey } = ctx;

      // 心跳 session 禁止调用 complete / fail
      if (
        (toolName === 'mteam_complete_task' || toolName === 'mteam_fail_task')
        && sessionKey?.endsWith(':heartbeat')
      ) {
        return {
          block: true,
          blockReason: `心跳 session（${sessionKey}）禁止调用 ${toolName}，请通过 relay 转移任务`,
        };
      }

      return {};
    },
  );
}
