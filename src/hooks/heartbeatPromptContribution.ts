/**
 * M-Team Hooks — heartbeat_prompt_contribution
 *
 * 在 executor 心跳运行时，自动注入 mteam 任务池操作指令。
 * 无需修改任何 workspace 的 HEARTBEAT.md。
 */

import type {
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
} from 'openclaw/plugins/host-hook-turn-types';

interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
}

export interface OpenClawApi {
  logger?: Logger;
}

interface RegisterOptions {
  executors: string[];
}

const EXECUTOR_HEARTBEAT_PROMPT = `你是 M-Team Executor。

## 本次心跳任务
调用 mteam_get_agent_active({ agentId }) 查询当前是否有进行中任务。

## 状态判断
- 有任务（running）→ mteam_update_task({ taskId, lastHeartbeatAt: Date.now() }) → 回复 HEARTBEAT_OK
- 无任务 → mteam_get_pending({ agentId }) → 若有待领取 → mteam_claim_task({ agentId, taskId }) → 回复 HEARTBEAT_OK
- 无任务且没有合适的 → 回复 HEARTBEAT_OK（空转）

回复内容只写 "HEARTBEAT_OK"（不需要其他内容）。`;

export function registerHeartbeatPromptContributionHook(
  api: OpenClawApi,
  options: RegisterOptions,
): void {
  const executors = new Set(options.executors ?? ['maker', 'fixer', 'scholar', 'captain']);

  api.on(
    'heartbeat_prompt_contribution',
    async (
      event: PluginHeartbeatPromptContributionEvent,
    ): Promise<PluginHeartbeatPromptContributionResult | undefined> => {
      const { agentId } = event;

      // 不在配置名单内，不注入
      if (!agentId || !executors.has(agentId)) {
        return undefined;
      }

      api.logger?.info('[m-team] heartbeat_prompt_contribution 注入 executor 指令', {
        agentId,
      });

      return {
        appendContext: EXECUTOR_HEARTBEAT_PROMPT,
      };
    },
  );
}
