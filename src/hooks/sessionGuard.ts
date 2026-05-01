/**
 * M-Team Hooks — sessionGuard
 *
 * 在 tool 调用前拦截心跳 session，禁止其调用任务执行类工具。
 * 保证 claim_task 启动的 executor session 才是唯一能完成任务的主体。
 */

import type {
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
} from 'openclaw/plugins/host-hook-turn-types.js';

// ============================================================
// OpenClaw Plugin API 子集（内联，无外部依赖）
// ============================================================

interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
}

export interface OpenClawApi {
  logger?: Logger;
  on(event: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void>): void;
}

// heartbeat session 的 sessionKey 末尾带 `:heartbeat`
const HEARTBEAT_SESSION_SUFFIX = ':heartbeat';

// 只允许 executor session 调用，heartbeat session 禁止
const EXECUTOR_ONLY_TOOLS = new Set([
  'mteam_complete_task',
  'mteam_relay_task',
  'mteam_cancel_task',
]);

export function registerSessionGuardHook(api: OpenClawApi): void {
  api.on(
    'before_tool_call',
    async (
      event: PluginHookBeforeToolCallEvent,
      ctx: PluginHookToolContext,
    ): Promise<PluginHookBeforeToolCallResult | undefined> => {
      const { toolName } = event;

      // 不关心的工具，直接放行
      if (!EXECUTOR_ONLY_TOOLS.has(toolName)) {
        return undefined;
      }

      const sessionKey = ctx.sessionKey ?? '';

      if (!sessionKey.endsWith(HEARTBEAT_SESSION_SUFFIX)) {
        // 非 heartbeat session，放行
        return undefined;
      }

      api.logger?.warn('[m-team] sessionGuard 拦截 heartbeat session 调用执行类工具', {
        toolName,
        sessionKey,
      });

      return {
        block: true,
        reason: `heartbeat session（${sessionKey}）禁止调用 ${toolName}，任务完成由 executor session 负责`,
      };
    },
  );
}
