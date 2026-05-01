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

## 约束（必须遵守）

### mteam_update_task — 只允许这三个字段
\`\`\`javascript
mteam_update_task({ taskId, agentId, lastHeartbeatAt })
\`\`\`
禁止传入：status、contextStep、contextOutput、executor、priority

### mteam_relinquish_task — 只能放弃死任务
\`\`\`javascript
mteam_relinquish_task({ taskId, executorId })
\`\`\`
只用于：session 已死（updatedAt > 20min）且无法恢复
禁止传入：contextStep（会污染审计链）

### 认领任务后
认领任务（claim_task）后，不要在自己（heartbeat session）里调用 complete_task。
任务由 plugin 启动的独立 executor session 执行，heartbeat 只负责认领和保活。

## 本次心跳任务

调用 mteam_get_agent_active({ agentId }) 查询当前是否有进行中任务。

### 有任务（activeTask 有值）
1. 用 sessions_list({ agentId }) 查询本 agent 所有 session
2. 找到 key 包含 activeTask.taskId 的那个 session
3. 判断 session 是否真实活跃：execSession.updatedAt 存在且距离现在 < 20 分钟
   - **session 活跃** → mteam_update_task({ taskId: activeTask.taskId, agentId, lastHeartbeatAt: Date.now() })
   - **session 已死** → mteam_relinquish_task({ taskId: activeTask.taskId, executorId: agentId })

### 无任务
1. 调用 mteam_get_pending({ agentId })
2. 看每个 pending task 的 description（当前这一步做什么），判断是否适合自己
   - 读本 agent 的 IDENTITY.md，理解自己职责范围
   - description 与 IDENTITY 匹配才认领，不匹配就跳过
3. 若有合适的 → mteam_claim_task({ agentId, taskId })
4. 若没有合适的 → 空转（不乱接）

## 注意
- 心跳 session 不执行任务，只负责"抢任务"和"保活"
- claimed ≠ 正在执行，真实执行由独立的 executor session 负责
- 禁止在未调用任何工具的情况下自行结束会话
- 严格遵守字段约束，多传任何额外字段都是 ETL

回复内容只写 "HEARTBEAT_OK"。`;

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
      const { agentId, sessionKey } = event;

      console.error('[m-team] heartbeat_prompt_contribution hook FIRED', JSON.stringify({ agentId, sessionKey }));

      // 不在配置名单内，不注入
      if (!agentId || !executors.has(agentId)) {
        api.logger?.info('[m-team] heartbeat_prompt_contribution 跳过: agentId不在executors名单', {
          agentId, executors: [...executors]
        });
        return undefined;
      }

      api.logger?.info('[m-team] heartbeat_prompt_contribution 注入 executor 指令', {
        agentId,
        sessionKey,
      });

      // TODO: 临时调试日志，executor 重复 claim 问题时删除
      console.error('[DEBUG heartbeat] agentId=' + agentId + ' sessionKey=' + sessionKey);

      return {
        appendContext: EXECUTOR_HEARTBEAT_PROMPT,
      };
    },
  );
}
