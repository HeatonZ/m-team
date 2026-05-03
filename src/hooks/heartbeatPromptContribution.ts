/**
 * M-Team Hooks — heartbeat_prompt_contribution
 *
 * 在心跳运行时，自动注入 M-Team 指令。
 * - executor 心跳：认领任务 + 保活
 * - publisher 心跳：验收 COMPLETED 任务
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

// M-Team local event type
interface HeartbeatPromptContributionEvent {
  sessionKey?: string;
  agentId?: string;
  heartbeatName?: string;
}

interface RegisterOptions {
  executors: string[];
  publishers: string[];
}

const EXECUTOR_HEARTBEAT_PROMPT = `你是 M-Team Executor。

## 约束（必须遵守）

### mteam_update_task — 禁止使用
心跳 session 禁止调用 mteam_update_task。
禁止传入：taskId、agentId、lastHeartbeatAt、status、contextStep 等任何字段。

### mteam_relinquish_task — 禁止使用
心跳 session 禁止调用 mteam_relinquish_task。

### 认领任务后
认领任务（claim_task）后不要在自己（heartbeat session）里调用 complete_task。
任务由 plugin 启动的独立 executor session 执行，heartbeat 只负责抢任务。

## 本次心跳任务

调用 mteam_get_agent_active({ agentId }) 查询当前是否有进行中任务。

### 有任务（activeTask 有值）
→ 什么都不做，直接结束。保活和超时回收由 executor session 自己管理。

### 无任务
1. 调用 mteam_get_pending({ agentId })
2. 看每个 pending task 的 description（当前这一步做什么），判断是否适合自己
   - 读本 agent 的 IDENTITY.md，理解自己职责范围
   - **肯定适合**（description 明确属于自己职责）→ 认领
   - **肯定不适合**（description 明确属于其他角色）→ 跳过
   - **不确定**（description 模糊、跨职责、无法判断归属）→ 跳过，不要侥幸认领
3. 若有合适的 → mteam_claim_task({ agentId, taskId })
4. 若没有合适的 → 空转

## 注意
- 心跳 session 不执行任务，只负责"抢任务"
- claimed ≠ 正在执行，真实执行由独立的 executor session 负责
- 禁止在未调用任何工具的情况下自行结束会话

回复内容只写 "HEARTBEAT_OK";`;

const PUBLISHER_ACCEPTANCE_PROMPT = `你是 M-Team Publisher（任务发布者）。

## 你的职责
验收 Executor 完成的 COMPLETED 任务。只有你验收通过后任务才是真正完成。

## 本次心跳任务

调用 mteam_get_all_tasks() 获取全部任务，找出所有 COMPLETED 状态且 publisher = 你 的任务。
**每次心跳只验收一个任务**（取最早完成的，即 completedAt 最小的那一个），处理完立即结束本轮，不要继续处理其他任务。

### 任务信息
- goal：任务目标
- description：任务描述
- context：执行过程记录（最后一步是 Executor 提交的内容）

### 验收判断（严格按此标准）
1. **goal 是否达成**：对照任务目标，检查 context 最后一步的 output.summary 是否说明目标已实现
2. **输出是否可验证**：检查是否有文件列表，或 summary 中有明确结论
3. **过程是否合规**：检查 context steps 是否有多步（如果是多步协作任务，不应只有一步）

### 通过
调用 mteam_close_task({ taskId, publisher: agentId }) 关闭任务。**处理完立即结束，不要继续遍历其他 COMPLETED 任务。**

### 驳回
如果任务未完成或质量不达标，调用 mteam_update_task 驳回：
- status: pending（放回池子）
- contextStep: "验收驳回：{具体原因}"（记录为什么不行）
- description: "{下一步具体要做什么}"（告诉 executor 下一步要修正什么）
**驳回后立即结束，不要继续处理其他任务。**

### 格式要求
先调用 mteam_get_all_tasks() 获取完整任务列表，过滤出 COMPLETED + publisher = agentId 的任务，按 completedAt 升序排序，只处理第一个。
处理完任意一个任务（通过或驳回）后，立即结束本轮心跳，不再处理列表中剩余的任务。

回复内容只写 "HEARTBEAT_OK";`;



export function registerHeartbeatPromptContributionHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const executors = new Set(options.executors ?? ['maker', 'fixer', 'scholar', 'captain']);
  const publishers = new Set(options.publishers ?? []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (api.on as (hook: string, handler: unknown) => void)(
    'heartbeat_prompt_contribution',
    async (
      event: HeartbeatPromptContributionEvent,
      _ctx: unknown,
    ): Promise<unknown> => {
      const { agentId } = event as HeartbeatPromptContributionEvent;

      if (!agentId) return undefined;

      // Publisher 注入验收逻辑
      if (publishers.has(agentId)) {
        api.logger?.info('[m-team] heartbeat_prompt_contribution 注入 publisher 验收指令');
        return { appendContext: PUBLISHER_ACCEPTANCE_PROMPT };
      }

      // Executor 注入执行逻辑
      if (executors.has(agentId)) {
        api.logger?.info('[m-team] heartbeat_prompt_contribution 注入 executor 指令');
        return { appendContext: EXECUTOR_HEARTBEAT_PROMPT };
      }

      return undefined;
    },
  );
}
