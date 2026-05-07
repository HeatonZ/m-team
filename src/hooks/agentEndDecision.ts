/**
 * M-Team Hook — agent_end_decision
 *
 * 职责：在 executor session 结束时（subagent_ended），由 hook 统一判断任务应该
 * complete 还是 relay。executor 本身是纯执行者，不调用 completion 工具。
 *
 * 触发：subagent_ended，且 reason="complete"，outcome="ok"
 * 跳过：reason="error" | "killed" | "timeout"（执行过程出错，不需要再判断）
 *
 * 流程：
 *   executor 执行 → executor 结束 session（不调用 complete_task）
 *     → subagent_ended 触发（reason=complete, outcome=ok）
 *     → 读 tasks/{taskId}/task.json（goal + context）
 *     → 调 LLM 判断：任务完成了吗？
 *     → completeTask(pool, taskId) 或 relayTask(pool, taskId)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  OpenClawPluginApi,
  PluginHookSubagentEndedEvent,
  PluginHookSubagentContext,
} from 'openclaw/plugin-sdk/core';
import { completeTask, relayTask } from '../pool/operations.js';
import type { Task } from '../schema/task.js';

// LLM 判断超时
const LLM_TIMEOUT_MS = 30000;

// 从 targetSessionKey 解析 taskId
// 格式：agent:<agentId>:m-team:<taskId>
function parseTaskId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  const mTeamIdx = parts.indexOf('m-team');
  if (mTeamIdx < 0 || !parts[mTeamIdx + 1]) return null;
  return parts[mTeamIdx + 1];
}

// 读 task.json
function readTaskFile(taskId: string, workspaceRoot: string): Task | null {
  const taskPath = path.join(workspaceRoot, 'tasks', taskId, 'task.json');
  try {
    const raw = fs.readFileSync(taskPath, 'utf8');
    return JSON.parse(raw) as Task;
  } catch {
    return null;
  }
}

// 调用 LLM 判断任务是否完成
interface JudgeParams {
  runId: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
}

async function judgeByLlm(
  api: OpenClawPluginApi,
  task: Task,
  params: JudgeParams,
): Promise<'complete' | 'relay'> {
  const { goal, context, description } = task;

  // 从 context 提取已完成的步骤摘要
  const completedSteps = context
    .filter(s => s.type === 'step')
    .map(s => {
      const outputStr = s.output && Object.keys(s.output).length > 0
        ? ` → ${JSON.stringify(s.output)}`
        : '';
      return `- ${s.step}${outputStr}`;
    })
    .join('\n') || '(无执行步骤记录)';

  const prompt = `你是任务完成判断专家。以下是一个 M-Team 任务的上下文：

任务描述：${description || '(无描述)'}
任务目标：${goal}
已完成的步骤：
${completedSteps}

请判断：执行者是否完成了任务目标？
- 如果任务目标已达成（执行者已产出最终结果），返回：COMPLETE
- 如果任务目标未达成（还需要更多步骤才能达到目标），返回：RELAY

只返回 COMPLETE 或 RELAY，不要任何解释。`.trim();

  try {
    const result = await api.runtime.agent.runEmbeddedAgent({
      sessionId: params.sessionId,
      sessionKey: void 0,
      agentId: void 0,
      messageProvider: void 0,
      messageChannel: void 0,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      agentDir: void 0,
      config: api.config,
      prompt,
      provider: void 0,
      model: void 0,
      timeoutMs: LLM_TIMEOUT_MS,
      runId: params.runId,
      trigger: 'manual',
      toolsAllow: [],
      disableTools: true,
      disableMessageTool: true,
      bootstrapContextMode: 'lightweight',
      verboseLevel: 'off',
      reasoningLevel: 'off',
      silentExpected: true,
    });

    const responseText = (result.payloads ?? [])
      .map(p => (p.text ?? '').trim())
      .filter(Boolean)
      .join('\n')
      .toUpperCase();

    if (responseText.includes('RELAY')) {
      return 'relay';
    }
    return 'complete';
  } catch (err) {
    // LLM 调用失败时，保守处理：标记为完成，避免任务卡在 RUNNING
    api.logger?.warn(`[m-team] agent_end_decision LLM 调用失败: ${String(err)}，保守标记为完成`);
    return 'complete';
  }
}

export function registerAgentEndDecisionHook(api: OpenClawPluginApi): void {
  api.on('subagent_ended', async (
    event: PluginHookSubagentEndedEvent,
    _ctx: PluginHookSubagentContext,
  ) => {
    const { targetSessionKey, outcome, reason } = event;

    // 1. 解析 taskId
    if (!targetSessionKey) return;
    const taskId = parseTaskId(targetSessionKey);
    if (!taskId) {
      // 非 m-team 格式的 session，不处理
      return;
    }
    api.logger?.info(`[m-team] agent_end_decision 正在执行`);

    // 2. 只处理正常结束的情况
    // reason=complete + outcome=ok → executor 正常退出，需要判断
    // reason=error/killed/timeout → 执行出错，不判断
    if (reason !== 'complete' || outcome !== 'ok') {
      api.logger.debug?.(`[m-team] agent_end_decision 跳过任务 ${taskId}（reason=${reason} outcome=${outcome}）`);
      return;
    }

    // 3. 读取 task.json
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pluginConfig = (api.pluginConfig ?? {}) as any;
    const workspaceRoot: string = pluginConfig.workspaceRoot ?? '/mnt/d/code/m-team';
    const task = readTaskFile(taskId, workspaceRoot);
    if (!task) {
      api.logger?.warn(`[m-team] agent_end_decision 无法读取任务 ${taskId} 的 task.json，跳过`);
      return;
    }

    // 构造 runEmbeddedAgent 所需参数（必填字段不能为 undefined）
    const runId = randomUUID();
    const sessionId = event.runId ?? runId;
    const sessionFile = path.join(os.tmpdir(), `m-team-judge-${runId}.json`);
    const workspaceDir = workspaceRoot;

    api.logger?.info(`[m-team] agent_end_decision 开始判断任务 ${taskId}`);

    // LLM 判断
    const decision = await judgeByLlm(api, task, { runId, sessionId, sessionFile, workspaceDir });

    // 5. 根据判断结果操作任务
    const executorId = task.executor || 'unknown';
    if (decision === 'relay') {
      const result = relayTask(taskId, executorId, {
        step: '[agent_end_decision] executor 正常结束，hook 判断需要 relay 回池',
      });
      if (result.success) {
        api.logger?.info(`[m-team] agent_end_decision 任务 ${taskId} → relay 成功`);
      } else {
        api.logger?.warn(`[m-team] agent_end_decision 任务 ${taskId} → relay 失败: ${result.reason}`);
      }
    } else {
      const result = completeTask(taskId, {
        step: '[agent_end_decision] executor 正常结束，hook 判断任务已完成',
      });
      if (result.success) {
        api.logger?.info(`[m-team] agent_end_decision 任务 ${taskId} → complete 成功`);
      } else {
        api.logger?.warn(`[m-team] agent_end_decision 任务 ${taskId} → complete 失败: ${result.reason}`);
      }
    }
  });
}
