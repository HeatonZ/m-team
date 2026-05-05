/**
 * M-Team Hooks — heartbeat_prompt_contribution
 *
 * 心跳 session 专用 hook：只负责接取任务。
 * 检测到空闲 executor 时，注入认领逻辑，引导其从任务池认领新任务。
 */

import type {
  OpenClawPluginApi,
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
} from 'openclaw/plugin-sdk/core';
import { getAgentActiveTask } from '../pool/index.js';

interface RegisterOptions {
  executors: string[];
}

// ============================================================
// Heartbeat 注入：认领新任务
// ============================================================

const CLAIM_PROMPT = `## 心跳任务：认领新任务

1. 先调用 mteam_get_pending({ agentId })
2. 优先检查：有没有 "lastExecutor 是自己" 的任务？
   - 有 → 先调用 mteam_get_task({ taskId }) 看 context
   - 如果 context 显示任务还没真正完成（缺最后一步）→ 重新认领继续做
   - 如果已完成但忘了 complete → 不用认领，调用 mteam_complete_task 即可
   - 如果不适合自己 → relay 回池子再继续检查其他
   - 没有 → 进入第3步
3. 从剩余 pending task 中找适合自己职责的（读 IDENTITY.md 判断）
   - **肯定适合** → 认领
   - **不确定 / 模糊** → 跳过，不要侥幸认领
4. 若有合适的 → mteam_claim_task({ agentId, taskId })
5. 若没有合适的 → 回复 "HEARTBEAT_OK"

回复内容只写 "HEARTBEAT_OK";`;

// ============================================================
// Hook 注册
// ============================================================

export function registerHeartbeatPromptContributionHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const executors = new Set(options.executors ?? ['maker', 'fixer', 'scholar', 'captain']);

  (api.on as (hook: string, handler: (...args: unknown[]) => unknown) => void)(
    'heartbeat_prompt_contribution',
    (
      event: PluginHeartbeatPromptContributionEvent,
      _ctx: unknown,
    ): PluginHeartbeatPromptContributionResult | undefined => {
      const { agentId } = event;
      if (!agentId || !executors.has(agentId)) return undefined;

      // 有进行中任务 → 不注入，executor subagent 自己会处理
      const activeTask = getAgentActiveTask(agentId);
      if (activeTask) return undefined;

      // 空闲状态 → 注入认领逻辑
      api.logger?.info('[m-team] heartbeat 注入认领指令');
      return { appendContext: CLAIM_PROMPT };
    },
  );
}
