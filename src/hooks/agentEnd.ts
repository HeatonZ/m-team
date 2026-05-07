/**
 * M-Team Hook — agent_end (统一处理)
 *
 * 替代 subagent_ended + agentEndDecision。
 * agent_end 触发于所有 agent turn 结束，通过 sessionKey 识别 m-team session。
 *
 * 逻辑：
 *   success=false → failTask
 *   success=true  → LLM 读对话记录判断 complete vs relay
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  OpenClawPluginApi,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
} from 'openclaw/plugin-sdk/core';
import { failTask, completeTask, relayTask } from '../pool/operations.js';
import { writeTaskLog } from '../pool/db.js';
import {
  sendNotifications,
  getNotifications,
  formatFailNotifications,
  formatRelayNotifications,
  formatTaskNotifications,
} from '../notifications.js';
import type { Task } from '../schema/task.js';

const LLM_TIMEOUT_MS = 30000;

// ── helpers ──────────────────────────────────────────────────────────────────

function parseTaskId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  const mTeamIdx = parts.indexOf('m-team');
  if (mTeamIdx < 0 || !parts[mTeamIdx + 1]) return null;
  return parts[mTeamIdx + 1];
}

function readTaskFile(taskId: string, workspaceRoot: string): Task | null {
  const taskPath = path.join(workspaceRoot, 'tasks', taskId, 'task.json');
  try {
    const raw = fs.readFileSync(taskPath, 'utf8');
    return JSON.parse(raw) as Task;
  } catch {
    return null;
  }
}

/** 将 AgentMessage 数组格式化为可读的文本 */
function formatMessages(messages: unknown[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const role = String(m.role ?? 'unknown');

    // 跳过 system 消息（钩子/框架注入的不相关）
    if (role === 'system') continue;

    const content = extractText(m.content);
    if (!content) continue;

    const label = role === 'user' ? 'USER' : role === 'assistant' ? 'AGENT' : `[${role}]`;
    // 截断过长内容，只保留核心
    const truncated = content.length > 2000
      ? content.slice(0, 2000) + '\n...（内容截断）'
      : content;
    lines.push(`【${label}】${truncated}`);
  }

  return lines.join('\n\n') || '(对话记录为空)';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    // 多模态 content: [{type: 'text', text: '...'}, ...]
    if (Array.isArray(c)) {
      return c
        .filter((part: unknown) => {
          const p = part as Record<string, unknown>;
          return p?.type === 'text' || p?.type === 'input_text';
        })
        .map((part: unknown) => String((part as Record<string, unknown>).text ?? ''))
        .join('');
    }
    // 单一 text 字段
    if (typeof c.text === 'string') return c.text;
    if (typeof c.content === 'string') return c.content;
  }
  return '';
}

interface JudgeParams {
  runId: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
}

async function judgeByLlm(
  api: OpenClawPluginApi,
  task: Task,
  messages: unknown[],
  params: JudgeParams,
): Promise<'complete' | 'relay'> {
  const { goal, description, context } = task;
  const transcript = formatMessages(messages);

  // 将 context 数组格式化为可读文本
  const contextText = context.length > 0
    ? context.map((ctx, i) => {
        if (ctx.type === 'input') {
          return `[步骤 ${i}] 初始输入: ${JSON.stringify(ctx.data ?? {})}`;
        }
        return `[步骤 ${i}] 执行者: ${ctx.executor ?? '?'} | 步骤: ${ctx.step ?? '?'} | 输出: ${JSON.stringify(ctx.output ?? {})} | 完成时间: ${ctx.completedAt ? new Date(ctx.completedAt).toLocaleString() : '?'}`;
      }).join('\n')
    : '(无 context 历史)';

  const prompt = `你是任务完成判断专家。以下是 M-Team 任务的完整上下文：

=== 任务目标（终态标尺）===
${goal}

=== 当前步骤描述（description）===
${description || '(无描述)'}

=== Context 历史（所有已完成步骤）===
${contextText}

=== 执行者对话记录 ===
${transcript}
=== 对话记录结束 ===

请综合以上全部信息判断：执行者是否完成了任务目标？
- 任务目标已达成，或 context 已包含完整执行路径 → COMPLETE
- 任务目标未达成，还需要下一步 → RELAY

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

    return responseText.includes('RELAY') ? 'relay' : 'complete';
  } catch (err) {
    api.logger?.warn(`[m-team] agent_end LLM 判断失败: ${String(err)}，保守标记为完成`);
    return 'complete';
  }
}

// ── hook register ────────────────────────────────────────────────────────────

export function registerAgentEndHook(api: OpenClawPluginApi): void {
  // ⚠️ agent_end 是 conversation hook，非 bundled 插件需 allowConversationAccess: true
  api.on('agent_end', async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    const { success, error, durationMs, messages } = event;
    const { sessionKey, agentId } = ctx;

    // 只处理 m-team session
    if (!sessionKey?.startsWith('agent:')) return;
    const taskId = parseTaskId(sessionKey);
    if (!taskId) return;

    console.error(
      `[m-team] agent_end: taskId=${taskId} agentId=${agentId ?? '?'} ` +
        `success=${success} duration=${durationMs ?? '?'} msgs=${messages?.length ?? 0}`
    );

    // ── 异常结束 → fail ──
    if (!success) {
      const errorMsg = error ?? 'unknown_error';
      const result = failTask(taskId, errorMsg, undefined, { outcome: 'error', error: errorMsg });
      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        error: errorMsg,
      });
      sendNotifications(
        formatFailNotifications(task, getNotifications()),
        api.logger ?? null
      ).catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
      api.logger?.info(
        result.success
          ? `[m-team] agent_end: 任务 ${taskId} 标记失败`
          : `[m-team] agent_end: 任务 ${taskId} 无操作 (${result.reason})`
      );
      return;
    }

    // ── 正常结束 → LLM 判断 complete/relay ──
    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const workspaceRoot: string = (pluginConfig.workspaceRoot as string) ?? '/mnt/d/code/m-team';
    const task = readTaskFile(taskId, workspaceRoot);
    if (!task) {
      api.logger?.warn(`[m-team] agent_end: 无法读取任务 ${taskId} 的 task.json，跳过`);
      return;
    }

    const runId = randomUUID();
    const sessionId = event.runId ?? runId;
    const sessionFile = path.join(os.tmpdir(), `m-team-judge-${runId}.json`);

    api.logger?.info(`[m-team] agent_end: 开始判断任务 ${taskId}（基于 ${messages?.length ?? 0} 条消息）`);
    const decision = await judgeByLlm(api, task, messages ?? [], {
      runId,
      sessionId,
      sessionFile,
      workspaceDir: workspaceRoot,
    });

    const executorId = task.executor || 'unknown';
    if (decision === 'relay') {
      const result = relayTask(taskId, executorId, {
        step: '[agent_end] executor 正常结束，hook 判断需要 relay',
      });
      writeTaskLog({
        taskId,
        action: 'relay',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
      });
      if (result.task) {
        sendNotifications(
          formatRelayNotifications(result.task, getNotifications()),
          api.logger ?? null
        ).catch(err => api.logger?.error(`[m-team] relay 通知发送失败: ${String(err)}`));
      }
      api.logger?.info(
        result.success
          ? `[m-team] agent_end: 任务 ${taskId} → relay`
          : `[m-team] agent_end: 任务 ${taskId} → relay 失败: ${result.reason}`
      );
    } else {
      const result = completeTask(taskId, {
        step: '[agent_end] executor 正常结束，hook 判断任务完成',
      });
      writeTaskLog({
        taskId,
        action: 'complete',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
      });
      if (result.task) {
        sendNotifications(
          formatTaskNotifications(result.task, getNotifications()),
          api.logger ?? null
        ).catch(err => api.logger?.error(`[m-team] complete 通知发送失败: ${String(err)}`));
      }
      api.logger?.info(
        result.success
          ? `[m-team] agent_end: 任务 ${taskId} → complete`
          : `[m-team] agent_end: 任务 ${taskId} → complete 失败: ${result.reason}`
      );
    }
  });
}
