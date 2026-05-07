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

interface JudgeResult {
  decision: 'complete' | 'relay';
  /** relay 时建议的下一 description，complete 时为空 */
  nextDescription?: string;
  /** 本次步骤在 context 里记录的摘要 */
  contextStep: string;
  /** 本次步骤的输出（files 等） */
  contextOutput: Record<string, unknown>;
}

async function judgeByLlm(
  api: OpenClawPluginApi,
  task: Task,
  messages: unknown[],
  params: JudgeParams,
): Promise<JudgeResult> {
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

请综合以上全部信息判断：

**第一步**：执行者是否完成了任务目标？
- 任务目标已达成，或 context 已包含完整执行路径 → DECISION: COMPLETE
- 任务目标未达成，还需要下一步 → DECISION: RELAY

**第二步（仅 RELAY 时）**：为下一棒 executor 生成下一步描述。
- 根据 context 历史和对话记录，推断下一步具体要做什么
- 用一句话描述下一步动作，简明扼要，便于下一 executor 直接认领执行
- 如果 context 已完整，只需要简单描述"整理/汇总/交付"类收尾动作

输出格式：
DECISION: COMPLETE
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}

或者：
DECISION: RELAY
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}
下一步描述：<一句话描述>`.trim();

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

    const raw = (result.payloads ?? [])
      .map(p => (p.text ?? '').trim())
      .filter(Boolean)
      .join('\n');

    const relayMatch = raw.match(/DECISION:\s*RELAY\s*\n+下一步描述：(.+)/i);
    if (relayMatch) {
      const nextDesc = relayMatch[1].trim();
      return {
        decision: 'relay',
        nextDescription: nextDesc,
        contextStep: extractField(raw, 'CONTEXT_STEP') || description || '执行步骤',
        contextOutput: parseContextOutput(raw),
      };
    }

    if (raw.toUpperCase().includes('DECISION:') && raw.toUpperCase().includes('COMPLETE')) {
      return {
        decision: 'complete',
        contextStep: extractField(raw, 'CONTEXT_STEP') || description || '执行步骤',
        contextOutput: parseContextOutput(raw),
      };
    }

    // 兜底：无法解析 → relay 回池子，不轻易标记完成
    api.logger?.warn(`[m-team] agent_end LLM 判断结果无法解析 "${raw.slice(0, 200)}"，放回任务池`);
    return { decision: 'relay', contextStep: description || '执行步骤', contextOutput: {}, nextDescription: '请检查上下文后继续执行' };
  } catch (err) {
    api.logger?.warn(`[m-team] agent_end LLM 判断失败: ${String(err)}，放回任务池`);
    return { decision: 'relay', contextStep: description || '执行步骤', contextOutput: {}, nextDescription: '请检查上下文后继续执行' };
  }
}

// ── 解析辅助 ────────────────────────────────────────────────────────────────

function extractField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseContextOutput(raw: string): Record<string, unknown> {
  const match = raw.match(/CONTEXT_OUTPUT:\s*(\{[\s\S]+?\})/i);
  if (!match) return {};
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return {};
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
    if (decision.decision === 'relay') {
      const result = relayTask(taskId, executorId, {
        step: decision.contextStep,
        output: decision.contextOutput,
      }, decision.nextDescription);
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
        step: decision.contextStep,
        output: decision.contextOutput,
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
