/**
 * M-Team Hooks — heartbeat_prompt_contribution
 *
 * 在心跳运行时，自动注入 M-Team 指令。
 *
 * Executor（有 active task）→ 注入任务状态 + 下一步指导
 * Executor（无 active task）→ 注入抢任务指令
 * Publisher → 注入任务验收指令
 */

import type {
  OpenClawPluginApi,
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
} from 'openclaw/plugin-sdk/core';
import { getAgentActiveTask } from '../pool/index.js';

interface RegisterOptions {
  executors: string[];
  publishers: string[];
}

// ============================================================
// Prompt 片段库（按场景组装）
// ============================================================

/** Executor 约束（所有 executor session 必须遵守） */
const EXECUTOR_CONSTRAINTS = `## 约束（必须遵守）

### mteam_update_task — 禁止使用
心跳 session 禁止调用 mteam_update_task。
禁止传入：taskId、agentId、lastHeartbeatAt、status、contextStep 等任何字段。

### mteam_relinquish_task — 禁止使用
心跳 session 禁止调用 mteam_relinquish_task。

### 禁止在未调用任何工具的情况下自行结束会话
任务将永久卡在 running 状态。

## 注意
- claimed ≠ 正在执行，真实执行由 executor subagent 自己管理
- 心跳只负责"感知状态 + 注入指导"，不执行任务`;

const IDLE_GUIDANCE = `## 本次心跳任务：认领新任务

你当前没有进行中任务（activeTask = null）。

1. 调用 mteam_get_pending({ agentId })
2. 看每个 pending task 的 description（当前这一步做什么），判断是否适合自己
   - 读本 agent 的 IDENTITY.md，理解自己职责范围
   - **肯定适合**（description 明确属于自己职责）→ 认领
   - **肯定不适合**（description 明确属于其他角色）→ 跳过
   - **不确定**（description 模糊、跨职责、无法判断归属）→ 跳过，不要侥幸认领
3. 若有合适的 → mteam_claim_task({ agentId, taskId })
4. 若没有合适的 → 回复 "HEARTBEAT_OK"

回复内容只写 "HEARTBEAT_OK";`;

const TASK_CONTEXT_SECTION = (task: { taskId: string; goal: string; description: string; context: Array<{ step: string; output: Record<string, unknown> }> }): string => {
  const contextLines: string[] = [];
  // 显示已有的 context steps
  const steps = task.context.filter((c: { type: string }) => c.type === 'step');
  if (steps.length > 0) {
    contextLines.push('## 已完成步骤');
    steps.slice(-3).forEach((s: { step: string; output: Record<string, unknown> }, i: number) => {
      const summary = s.output?.summary ?? '（无摘要）';
      contextLines.push(`${i + 1}. ${s.step} → ${summary}`);
    });
    contextLines.push('');
  }
  return contextLines.join('\n');
};

const NEXT_ACTION_SUGGESTION = (task: { description: string; context: Array<{ type: string; step: string }> }): string => {
  // 从 description 提取当前步的要点，给 executor 提示
  const lastStep = task.context.filter((c: { type: string }) => c.type === 'step').at(-1);
  if (lastStep) {
    return `当前 description：${task.description}`;
  }
  return `当前 description：${task.description}`;
};

/** 生成 executor 有任务时的注入内容 */
function buildExecutorActiveTaskPrompt(task: {
  taskId: string;
  goal: string;
  description: string;
  context: Array<{ type: string; step: string; output: Record<string, unknown> }>;
}): string {
  const contextSection = TASK_CONTEXT_SECTION(task);
  const nextHint = NEXT_ACTION_SUGGESTION(task);

  return `你是 M-Team Executor。

${EXECUTOR_CONSTRAINTS}

## 本次心跳任务：已有进行中任务

你当前有进行中任务：${task.taskId}

### 任务目标
${task.goal}

### 当前 description（这步要做什么）
${task.description}

${contextSection}### 下一步提示
${nextHint}
## 决策指引（来自 mteam-executor skill + SOUL.md）

启动任务前，先读本角色的 SOUL.md：
- maker → /mnt/d/code/m-team/executors/maker/SOUL.md
- fixer → /mnt/d/code/m-team/executors/fixer/SOUL.md
- scholar → /mnt/d/code/m-team/executors/scholar/SOUL.md
- captain → /mnt/d/code/m-team/executors/captain/SOUL.md

参考 skill「mteam-executor」执行方法论 + 本角色 SOUL.md，判断下一步：

1. **任务目标（goal）是否已达成？**
   - 明确达成 → 调用 mteam_complete_task（contextStep 说明做了什么，output.summary 包含具体结果）
   - 不确定 → 问自己：有没有办法验证？能验证 → 验证后再判断；不能验证 → 升级

2. **是否需要交接给下一个 executor？**
   - 需要下一棒（不同角色或不同能力）→ 调用 mteam_relay_task
   - relay 时 next_action 必须动词开头、边界清晰，格式：
 relay_to / next_action / handoff_context
   - 不需要下一棒 → 自己继续或升级

3. **遇到技术障碍？**
   - 能自行解决（尝试过两条不同方法）→ 自己解决
   - 无法自行解决 → relay 回池子，写清楚障碍

## 立即行动
1. 调用 mteam_get_agent_active({ agentId }) 确认当前任务
2. 根据上述决策树判断下一步
3. 执行对应的 tool call（complete / relay / 继续执行）

回复内容只写 "HEARTBEAT_OK";`;
};

// ============================================================
// Publisher prompt（验收逻辑）
// ============================================================

const PUBLISHER_ACCEPTANCE_PROMPT = `你是 M-Team Publisher（任务发布者）。

## 你的职责
验收 Executor 完成的 COMPLETED 任务。只有你验收通过后任务才是真正完成。

## 本次心跳任务

1. 调用 mteam_get_all_tasks() 获取全部任务
2. 过滤出 COMPLETED 状态且 publisher = 你 的任务
3. 按 completedAt 升序，取最早完成的第一个任务
4. **每次心跳只验收一个任务**，处理完立即结束

### 任务信息
- goal：任务目标
- description：任务描述
- context：执行过程记录（最后一步是 Executor 提交的内容）

### 验收判断（严格按此标准）
1. **goal 是否达成**：对照任务目标，检查 context 最后一步的 output.summary 是否说明目标已实现
2. **输出是否可验证**：检查是否有文件列表，或 summary 中有明确结论
3. **过程是否合规**：检查 context steps 是否有多步（多步骤任务不应只有一步）

### 通过
调用 mteam_close_task({ taskId, publisher: agentId }) 关闭任务。
处理完立即结束，不再处理其他任务。

### 驳回
如果任务未完成或质量不达标，调用 mteam_update_task 驳回：
- status: pending（放回池子）
- contextStep: "验收驳回：{具体原因}"（记录为什么不行）
- description: "{下一步具体要做什么}"（告诉 executor 下一步要修正什么）
**驳回后立即结束，不再处理其他任务。**

回复内容只写 "HEARTBEAT_OK";`;

// ============================================================
// Hook 注册
// ============================================================

export function registerHeartbeatPromptContributionHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const executors = new Set(options.executors ?? ['maker', 'fixer', 'scholar', 'captain']);
  const publishers = new Set(options.publishers ?? []);

  (api.on as (hook: string, handler: (...args: unknown[]) => unknown) => void)(
    'heartbeat_prompt_contribution',
    (
      event: PluginHeartbeatPromptContributionEvent,
      _ctx: unknown,
    ): PluginHeartbeatPromptContributionResult | undefined => {
      const { agentId } = event;

      if (!agentId) return undefined;

      // Publisher 注入验收逻辑
      if (publishers.has(agentId)) {
        api.logger?.info('[m-team] heartbeat_prompt_contribution 注入 publisher 验收指令');
        return { appendContext: PUBLISHER_ACCEPTANCE_PROMPT };
      }

      // Executor 注入执行逻辑
      if (executors.has(agentId)) {
        // 先查有没有进行中的任务
        const activeTask = getAgentActiveTask(agentId);

        if (activeTask) {
          // 有任务 → 注入任务状态 + 下一步指导
          api.logger?.info(`[m-team] heartbeat 注入 executor 任务指导：${activeTask.taskId}`);
          return { appendContext: buildExecutorActiveTaskPrompt(activeTask) };
        } else {
          // 无任务 → 注入认领指导
          api.logger?.info('[m-team] heartbeat 注入 executor 空闲认领指令');
          return { appendContext: IDLE_GUIDANCE };
        }
      }

      return undefined;
    },
  );
}
