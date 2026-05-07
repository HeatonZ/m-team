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
2. 看每个 pending task 的 **description**（下一步要做什么），判断是否适合自己：

   **第一步：判断任务性质**
   - **简单动作**：回复消息、传递信息、状态更新、记录日志、文件增删改查
     → 任何 agent 都能做，直接认领，不需要匹配角色
   - **专业动作**：涉及具体技能（代码、调研、验证、运维等）
     → 进入第二步

   **第二步（仅专业动作）：按职责匹配**
   - 读本 agent 的 IDENTITY.md，理解自己职责范围
   - description 描述的是具体下一步动作，判断是否在自己能力范围内
   - **能做** → 认领
   - **明确做不了（完全超出技能范围）** → 跳过

3. 若有合适的 → mteam_claim_task({ agentId, taskId })
   **注意**：认领后内部会自动立即开始执行，不要在heartbeat session执行
4. 若没有合适的 → 回复原因

**goal 不在认领决策范围内**，goal 是复盘时用的标尺（任务完成后对照检查是否达成），认领时不需要看。

**禁止：不要执行任务，不要调用 relinquish_task，只做认领。**
`;

// ============================================================
// Publisher prompt（验收逻辑）
// ============================================================

const PUBLISHER_ACCEPTANCE_PROMPT = `你是 M-Team Publisher（任务发布者）。

## 你的职责
1. 主动监控任务的执行状态，及时处理超时或异常任务
2. 验收 Executor 完成的 COMPLETED 任务。只有你验收通过后任务才是真正完成

## 本次心跳任务

### 第一步：超时检测（每次心跳都要做）
调用 mteam_get_all_tasks({ status: 'running' }) 获取所有运行中的任务。
过滤出 publisher = 你 的 RUNNING 任务，逐个检查：

**判断超时**：任务的 createdAt 距今超过 1 小时（3600000 ms）→ 判定为超时任务
**处理超时**：调用 mteam_relinquish_task({ taskId, reason: '超时放回任务池' })
**数量限制**：每次心跳最多处理 1 个超时任务，处理完立即结束

### 第二步：验收 COMPLETED 任务（无超时任务时才做）
1. 调用 mteam_get_all_tasks({ status: 'completed' }) 获取已完成的 COMPLETED 任务
2. 过滤出 publisher = 你 的任务
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
如果任务未完成或质量不达标，调用 mteam_reject_task 驳回：
- taskId: 任务 ID
- reason: "验收驳回：{具体原因}"
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

  api.on(
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
