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
    const truncated = content.length > 4000
      ? '...（前部内容截断）\n' + content.slice(-4000)
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
  /** LLM 判决理由 */
  reason: string;
  /** relay 前旧描述 */
  previousDescription: string;
  /** relay 后描述是否变化 */
  descriptionChanged: boolean;
  /** 判决解析状态，用于 dashboard 诊断 */
  parseStatus: 'ok' | 'llm_output_missing' | 'next_description_missing' | 'json_parse_failed' | 'timeout' | 'unknown_decision';
  /** LLM 原始输出尾部，用于排查截断/解析问题 */
  rawJudgeTail: string;
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

  // ── 输入日志 ──────────────────────────────────────────────────────────────
  const startMs = Date.now();
  const logTranscript = transcript.length > 500 ? transcript.slice(0, 500) + '\n...（截断）' : transcript;
  const logContext = contextText.length > 400 ? contextText.slice(0, 400) + '\n...（截断）' : contextText;
  console.error(
    `[m-team] judgeByLlm 输入: taskId=${task.taskId} goal="${goal.slice(0, 80)}" ` +
    `contextSteps=${context.length} msgs=${messages.length} description="${(description || '').slice(0, 100)}"`
  );
  console.error(`[m-team] judgeByLlm transcript(${transcript.length}): ${logTranscript.slice(0, 300)}`);
  console.error(`[m-team] judgeByLlm context(${contextText.length}): ${logContext.slice(0, 200)}`);

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

**下一步描述必须包含4个要素（缺一不可）：**
- 动作：动词开头（继续搜索、筛选、抓取、生成、提取）
- 目标：要操作的对象（宠物玩具、商品详情页、图片）
- 条件：明确的过滤维度（costPrice ≤ 5 RMB、规格数 ≤ 8）
- 数量逻辑：**"找够 N 个"**（数量不够就继续扩大搜索），禁止"前 N 个"

**坏味道（出现即预警）：**
- "继续搜索更多" → 没说要找多少个 ❌
- "做下一步" → 没写具体动作 ❌
- "数量不够继续找" → 没说要找多少个 ❌

**好味道（鼓励使用）：**
- "继续搜索宠物玩具，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8，找够剩余 3 个" ✅
- "抓取商品详情页，提取标题、价格、规格数" ✅

请根据 context 历史和对话记录推断下一步，用4要素模板生成一句话描述。

输出格式：
DECISION: COMPLETE
REASON: <为什么判断目标已达成>
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}

或者：
DECISION: RELAY
REASON: <为什么还需要下一棒>
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
      config: api.config,
      prompt,
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      authProfileId: 'minimax:cn',
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

    const elapsedMs = Date.now() - startMs;

    // ── LLM 原始输出日志 ──────────────────────────────────────────────────
    console.error(
      `[m-team] judgeByLlm 输出: taskId=${task.taskId} elapsed=${elapsedMs}ms ` +
      `raw="${raw.slice(0, 300)}"`
    );

    // ── 解析判决结果 ──────────────────────────────────────────────────────────

    // 规范化：删除首尾空白，取最后一行防截断问题
    const normalized = raw.trim();
    const lastLine = normalized.split('\n').pop() ?? normalized;

    // 检测 DECISION 类型（宽松匹配）
    const hasComplete = /DECISION:\s*COMPLETE/i.test(normalized);
    const hasRelay = /DECISION:\s*RELAY\b/i.test(normalized);

    // 提取下一步描述（多级降级）
    let nextDescription: string | undefined;
    for (const pattern of [
      /下一步描述[：:]\s*(.+)/i,
      /NEXT[_\s]STEP[：:]\s*(.+)/i,
      /下一步[：:]\s*(.+)/i,
      /接下来[做干什么]+[：:]\s*(.+)/i,
    ]) {
      const m = normalized.match(pattern);
      if (m?.[1]?.trim()) {
        nextDescription = m[1].trim();
        break;
      }
    }

    if (hasComplete) {
      const contextStep = extractField(normalized, 'CONTEXT_STEP') || description || '执行步骤';
      const contextOutput = parseContextOutput(normalized);
      const reason = extractField(normalized, 'REASON') || 'LLM 判定任务目标已达成';
      console.error(
        `[m-team] judgeByLlm 判决: COMPLETE taskId=${task.taskId} contextStep="${contextStep.slice(0, 80)}"`
      );
      return {
        decision: 'complete',
        contextStep,
        contextOutput,
        reason,
        previousDescription: description || '',
        descriptionChanged: false,
        parseStatus: 'ok',
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    if (hasRelay) {
      const contextStep = extractField(normalized, 'CONTEXT_STEP') || description || '执行步骤';
      const contextOutput = parseContextOutput(normalized);
      const nextDesc = nextDescription ?? description;
      const descriptionChanged = Boolean(nextDescription && nextDescription !== description);
      const parseStatus = nextDescription ? 'ok' : 'next_description_missing';
      const reason = extractField(normalized, 'REASON') || 'LLM 判定任务目标未达成，需要下一棒继续';
      console.error(
        `[m-team] judgeByLlm 判决: RELAY taskId=${task.taskId} changed=${descriptionChanged} ` +
        `parseStatus=${parseStatus} nextDescription="${(nextDesc || '').slice(0, 80)}" `
      );
      return {
        decision: 'relay',
        nextDescription: nextDesc,
        contextStep,
        contextOutput,
        reason,
        previousDescription: description || '',
        descriptionChanged,
        parseStatus,
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    // 兜底：无法解析 → relay 回池子，保留原描述
    console.error(
      `[m-team] judgeByLlm 判决: UNKNOWN（无法解析 raw="${lastLine.slice(0, 150)}"），强制 RELAY`
    );
    api.logger?.warn(`[m-team] agent_end LLM 判断结果无法解析 "${lastLine.slice(0, 200)}"，放回任务池`);
    return {
      decision: 'relay',
      contextStep: description || '执行步骤',
      contextOutput: {},
      nextDescription: description,
      reason: 'LLM 判决输出无法解析，兜底放回任务池',
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus: raw.trim() ? 'unknown_decision' : 'llm_output_missing',
      rawJudgeTail: normalized.slice(-1000),
    };
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    const errorText = String(err);
    const parseStatus = /timeout|timed out/i.test(errorText) ? 'timeout' : 'unknown_decision';
    console.error(
      `[m-team] judgeByLlm 异常: taskId=${task.taskId} elapsed=${elapsedMs}ms error=${errorText}`
    );
    api.logger?.warn(`[m-team] agent_end LLM 判断失败: ${errorText}，放回任务池`);
    return {
      decision: 'relay',
      contextStep: description || '执行步骤',
      contextOutput: {},
      nextDescription: description,
      reason: `LLM 判断失败：${errorText.slice(0, 300)}`,
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus,
      rawJudgeTail: errorText.slice(-1000),
    };
  }
}

// ── 解析辅助 ──────────────────────────────────────────────────────────────────

function extractField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, 'i'));
  return match ? match[1].trim() : '';
}

/**
 * 从 LLM 输出中提取 CONTEXT_OUTPUT JSON。
 * 使用栈匹配处理任意层级嵌套的 {}，
 * 解析失败时记录原始文本供排查。
 */
function parseContextOutput(raw: string): Record<string, unknown> {
  // 记录原始片段，方便调试排查
  const snippet = raw.slice(0, 500);
  console.error(`[m-team] parseContextOutput 输入: "${snippet}"`);

  const colonIdx = raw.indexOf('CONTEXT_OUTPUT:');
  if (colonIdx === -1) {
    console.error('[m-team] parseContextOutput: 未找到 CONTEXT_OUTPUT:，返回 {}');
    return {};
  }

  const afterLabel = raw.slice(colonIdx + 'CONTEXT_OUTPUT:'.length);
  const trimmed = afterLabel.trim();
  if (!trimmed.startsWith('{')) {
    console.error(`[m-team] parseContextOutput: CONTEXT_OUTPUT: 后不是 {，返回 {}`);
    return {};
  }

  // 栈匹配：正确处理嵌套 {}
  let depth = 0;
  let end = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') {
      if (depth === 0) depth = 1; // 从第一个 { 开始计数
      else depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) {
    console.error('[m-team] parseContextOutput: JSON 括号不匹配，返回 {}');
    return {};
  }

  const jsonStr = trimmed.slice(0, end);
  try {
    const result = JSON.parse(jsonStr) as Record<string, unknown>;
    console.error(`[m-team] parseContextOutput: 解析成功 result=${JSON.stringify(result).slice(0, 200)}`);
    return result;
  } catch (err) {
    console.error(`[m-team] parseContextOutput: JSON.parse 失败="${jsonStr.slice(0, 200)}" error=${err}`);
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

    // ── 读取 task.json（两个分支都需要） ──
    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const workspaceRoot: string = (pluginConfig.workspaceRoot as string) ?? '/mnt/d/code/m-team';
    const task = readTaskFile(taskId, workspaceRoot);
    if (!task) {
      api.logger?.warn(`[m-team] agent_end: 无法读取任务 ${taskId} 的 task.json，跳过`);
      return;
    }

    // ── 异常结束 → fail ──
    if (!success) {
      const errorMsg = error ?? 'unknown_error';
      const result = failTask(taskId, errorMsg, undefined, { outcome: 'error', error: errorMsg });
      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          reason: result.reason || errorMsg,
          decision: 'fail',
          parseStatus: 'ok',
          error: errorMsg,
        },
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
        result: {
          success: result.success,
          reason: result.reason || decision.reason,
          decision: 'relay',
          contextStep: decision.contextStep,
          contextOutput: decision.contextOutput,
          nextDescription: decision.nextDescription,
          previousDescription: decision.previousDescription,
          descriptionChanged: decision.descriptionChanged,
          parseStatus: decision.parseStatus,
          rawJudgeTail: decision.rawJudgeTail,
        },
      });
      console.error(
        `[m-team][agent_end] task=${taskId} decision=RELAY changed=${decision.descriptionChanged} ` +
        `parseStatus=${decision.parseStatus} previous="${(decision.previousDescription || '').slice(0, 120)}" ` +
        `next="${(decision.nextDescription || '').slice(0, 120)}" ` +
        `relaySuccess=${result.success} relayReason=${result.reason || decision.reason}`
      );
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
        result: {
          success: result.success,
          reason: result.reason || decision.reason,
          decision: 'complete',
          contextStep: decision.contextStep,
          contextOutput: decision.contextOutput,
          previousDescription: decision.previousDescription,
          descriptionChanged: false,
          parseStatus: decision.parseStatus,
          rawJudgeTail: decision.rawJudgeTail,
        },
      });
      console.error(
        `[m-team][agent_end] task=${taskId} decision=COMPLETE parseStatus=${decision.parseStatus} ` +
        `contextStep="${decision.contextStep.slice(0, 120)}"`
      );
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
