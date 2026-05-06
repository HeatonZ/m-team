/**
 * M-Team Hooks — heartbeat_prompt_contribution
 *
 * 心跳 session 专用 hook：只负责接取任务。
 * 检测到空闲 executor 时，注入认领逻辑，引导其从任务池认领新任务。
 * Publisher 心跳时注入验收逻辑。
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
// Heartbeat 注入：认领新任务
// ============================================================

const CLAIM_PROMPT = `## 心跳任务：认领新任务

**你处于心跳 session，只能认领任务，不能执行任务。**

1. 调用 mteam_get_pending({ agentId })
2. 看每个 pending task 的 **description**（下一步要做什么），判断是否适合自己
   - 读本 agent 的 IDENTITY.md，理解自己职责范围
   - description 描述的是具体下一步动作，只有当动作在自己能力范围内才认领
   - **肯定适合** → 认领
   - **不确定 / 模糊** → 跳过，不要侥幸认领
3. 若有合适的 → mteam_claim_task({ agentId, taskId })
4. 若没有合适的 → 回复 "HEARTBEAT_OK"

**goal 不在认领决策范围内**，goal 是复盘时用的标尺（任务完成后对照检查是否达成），认领时不需要看。

**禁止：不要执行任务，不要调用 relay_task / complete_task / relinquish_task / update_task，只做认领。**

回复内容只写 "HEARTBEAT_OK";`;

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

**核心原则：goal 是终态标尺，context 是达成路径。两者必须结合来看。**

1. **goal 是否达成**：对照任务目标，从 context 第一步看到最后一步，验证目标是否真正实现，而不是只看最后一步的 summary
2. **路径是否完整**：多步骤任务应有多步 context，单步骤任务也应有一一对应的执行痕迹。如果 context 只有一步但明显应该有前置步骤，说明执行者跳过了过程
3. **输出是否可验证**：检查文件是否真实存在（文件名、数量、路径），不要只看 summary 声称写了什么
4. **过程是否合规**：检查 context steps 是否有意义（不是无效的重复步骤，不是凑数的水步骤）

### 通过
调用 mteam_close_task({ taskId, publisher: agentId }) 关闭任务。
处理完立即结束，不再处理其他任务。

### 驳回
如果任务未完成或质量不达标，调用 mteam_update_task 驳回：
- taskId: 任务 ID
- agentId: 你的 agentId（即 publisher 身份）
- status: pending（放回池子）
- contextStep: "验收驳回：{具体原因}"
- description: "{下一步具体要做什么}"（只写下一棒要做什么，不写驳回原因，让下一个 executor 能直接接手）
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
        api.logger?.info('[m-team] heartbeat 注入 publisher 验收指令');
        return { appendContext: PUBLISHER_ACCEPTANCE_PROMPT };
      }

      // Executor 注入执行逻辑
      if (executors.has(agentId)) {
        // 有进行中任务 → 不注入，executor subagent 自己会处理
        const activeTask = getAgentActiveTask(agentId);
        if (activeTask) return undefined;

        // 空闲状态 → 注入认领逻辑
        api.logger?.info('[m-team] heartbeat 注入认领指令');
        return { appendContext: CLAIM_PROMPT };
      }

      return undefined;
    },
  );
}
