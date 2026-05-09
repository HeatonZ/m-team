/**
 * M-Team Hook — agent_end (统一处理)
 *
 * 作为 m-team executor 执行轮的唯一终态收口器：
 * - success=false → fail
 * - success=true  → judge complete / relay / fail(blocked)
 *
 * 关键原则：
 * - 只处理真正的 executor task session
 * - 先过 task/session/executor/terminal-log 边界检查
 * - 再做 judge
 * - 同描述 relay、reason-like description、重复无进展都直接熔断
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
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
import type { Task, TaskStatus } from '../schema/task.js';

const LLM_TIMEOUT_MS = 180000;
const TERMINAL_ACTIONS = new Set(['complete', 'relay', 'fail']);
const REPEATED_NO_PROGRESS_WINDOW = 4;
const NO_PROGRESS_REPEAT_THRESHOLD = 3;

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

function isExecutorSessionForTask(sessionKey: string | undefined, agentId: string | undefined, taskId: string): boolean {
  if (!sessionKey || !agentId) return false;
  return sessionKey === `agent:${agentId}:m-team:${taskId}`;
}

function hasTerminalLogForSession(taskId: string, sessionKey: string, workspaceRoot: string): boolean {
  const dbPath = path.join(workspaceRoot, 'queue', 'm-team.db');
  if (!fs.existsSync(dbPath)) return false;
  try {
    const db = new Database(dbPath, { readonly: true });
    const placeholders = [...TERMINAL_ACTIONS].map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT 1 FROM task_logs
         WHERE task_id = ? AND session_key = ? AND action IN (${placeholders})
         LIMIT 1`
      )
      .get(taskId, sessionKey, ...TERMINAL_ACTIONS) as { 1?: number } | undefined;
    db.close();
    return Boolean(row);
  } catch {
    return false;
  }
}

function getRelayDescription(decision: JudgeResult): string | undefined {
  if (!decision.nextDescription) return undefined;
  const next = decision.nextDescription.trim();
  const prev = (decision.previousDescription || '').trim();
  if (!next) return undefined;
  if (next === prev) return undefined;
  return next;
}

function buildRecoveryDescription(task: Task, reason: string, contextStep: string): string | undefined {
  const base = `${task.description} ${task.goal} ${reason} ${contextStep}`;
  const text = base.toLowerCase();

  const hasConstraintSignal = /spec|规格|constraint|条件|filter|筛选|price|成本|数量|quality|质量|校验|validate|invalid|violate|不合格|补足|替换|重筛/.test(text);
  if (!hasConstraintSignal) return undefined;

  const quantityMatch = base.match(/(?:补足到|找够|输出|筛出|提供)\s*(\d+)\s*个|quantity["'：:\s=]*(\d+)/i);
  const quantity = quantityMatch?.[1] || quantityMatch?.[2] || '目标数量';

  const maxCostMatch = base.match(/(?:≤|<=|小于等于|不高于)\s*(\d+(?:\.\d+)?)\s*元|maxCostPriceRmb["'：:\s=]*(\d+(?:\.\d+)?)/i);
  const maxSpecsMatch = base.match(/(?:<|小于)\s*(\d+)\s*(?:个)?规格|maxSpecs["'：:\s=]*(\d+)/i);

  const constraints: string[] = [];
  if (maxCostMatch?.[1] || maxCostMatch?.[2]) constraints.push(`成本价 ≤ ${maxCostMatch[1] || maxCostMatch[2]} 元`);
  if (maxSpecsMatch?.[1] || maxSpecsMatch?.[2]) constraints.push(`规格数 < ${maxSpecsMatch[1] || maxSpecsMatch[2]}`);

  const constraintText = constraints.length > 0 ? `，严格保留${constraints.join('、')}的商品` : '';
  return `重新筛选当前候选，移除不合格项${constraintText}，并补足到 ${quantity} 个合规结果`;
}

function shouldConvertFailToRecoveryRelay(task: Task, decision: JudgeResult): boolean {
  if (decision.decision !== 'fail') return false;
  if (decision.parseStatus !== 'ok') return false;
  if (decision.terminalType !== 'system_error') return false;

  const base = `${task.description} ${task.goal} ${decision.reason} ${decision.contextStep} ${JSON.stringify(decision.contextOutput ?? {})}`.toLowerCase();
  const hasRecoverableSignal = /spec|规格|constraint|条件|filter|筛选|price|成本|quantity|数量|quality|质量|校验|validate|invalid|violate|不合格|replace|替换|补足|重筛/.test(base);
  const hasHardStopSignal = /missing publisher|发布者|缺少前置|无法访问|权限|not found|登录失效|session empty|timeout|unknown_decision|llm/.test(base);

  return hasRecoverableSignal && !hasHardStopSignal;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: unknown) => {
        const p = part as Record<string, unknown>;
        return p?.type === 'text' || p?.type === 'input_text' || p?.type === 'thinking';
      })
      .map((part: unknown) => String((part as Record<string, unknown>).text ?? (part as Record<string, unknown>).thinking ?? ''))
      .join('');
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text;
    if (typeof c.content === 'string') return c.content;
  }
  return '';
}

function formatMessages(messages: unknown[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const role = String(m.role ?? 'unknown');
    if (role === 'system') continue;
    const content = extractText(m.content);
    if (!content) continue;
    const label = role === 'user' ? 'USER' : role === 'assistant' ? 'AGENT' : `[${role}]`;
    const truncated = content.length > 4000 ? '...（前部内容截断）\n' + content.slice(-4000) : content;
    lines.push(`【${label}】${truncated}`);
  }

  return lines.join('\n\n') || '(对话记录为空)';
}

function looksLikeReasonText(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  const patterns = [
    /缺少|无法|不能|未提供|建议发布者|请发布者|需要发布者|message_id|chat_id/i,
    /because|missing|cannot|unable|need publisher|publisher/i,
    /^任务(缺少|需要|无法)/,
    /^由于/,
    /^原因/,
  ];
  return patterns.some(pattern => pattern.test(t));
}

function normalizeReasonFingerprint(text: string): string {
  return text
    .replace(/task_\d+/g, 'task')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .toLowerCase();
}

function detectRepeatedNoProgress(task: Task, currentReason: string): boolean {
  const steps = (task.context ?? [])
    .filter((entry): entry is Record<string, unknown> => entry.type === 'step')
    .slice(-REPEATED_NO_PROGRESS_WINDOW);

  if (steps.length < NO_PROGRESS_REPEAT_THRESHOLD) return false;

  const currentFp = normalizeReasonFingerprint(currentReason || '');
  if (!currentFp) return false;

  let sameReasonCount = 0;
  let noProgressCount = 0;

  for (const step of steps) {
    const rawStep = String(step.step ?? '');
    const summary = String((step.output as Record<string, unknown> | undefined)?.summary ?? '');
    const combined = `${rawStep} ${summary}`.trim();
    if (!combined) continue;

    const fp = normalizeReasonFingerprint(combined);
    if (fp && (fp.includes(currentFp) || currentFp.includes(fp))) {
      sameReasonCount += 1;
    }

    if (/缺少|无法|不能|未提供|等待发布者|超时放回任务池|same_description_blocked|reason_like_description_blocked/i.test(combined)) {
      noProgressCount += 1;
    }
  }

  return sameReasonCount >= NO_PROGRESS_REPEAT_THRESHOLD && noProgressCount >= NO_PROGRESS_REPEAT_THRESHOLD;
}

function getRecentStepEntries(task: Task): Array<Record<string, unknown>> {
  return (task.context ?? []).filter((entry): entry is Record<string, unknown> => entry.type === 'step');
}

function getRelayAttempt(task: Task): number {
  const steps = getRecentStepEntries(task);
  let attempts = 0;
  for (const step of steps) {
    const output = (step.output as Record<string, unknown> | undefined) ?? {};
    const maybeAttempt = Number(output.relayAttempt ?? 0);
    if (Number.isFinite(maybeAttempt) && maybeAttempt > attempts) {
      attempts = maybeAttempt;
    }
  }
  return attempts;
}

function getNoProgressStreak(task: Task): number {
  const steps = getRecentStepEntries(task);
  let streak = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    const output = (steps[i].output as Record<string, unknown> | undefined) ?? {};
    const flag = output.noProgress === true;
    if (!flag) break;
    streak += 1;
  }
  return streak;
}

function buildDecisionMetrics(task: Task, reason: string, decision: 'complete' | 'relay' | 'fail'): { relayAttempt: number; noProgressStreak: number } {
  const repeated = detectRepeatedNoProgress(task, reason);
  const prevRelayAttempt = getRelayAttempt(task);
  const prevNoProgressStreak = getNoProgressStreak(task);
  const noProgress = repeated || looksLikeReasonText(reason);

  return {
    relayAttempt: decision === 'relay' ? prevRelayAttempt + 1 : prevRelayAttempt,
    noProgressStreak: decision === 'complete' ? 0 : (noProgress ? prevNoProgressStreak + 1 : 0),
  };
}

function logAgentEndSkip(reason: string, meta: Record<string, unknown>): void {
  const payload = JSON.stringify({ reason, ...meta });
  console.error(`[m-team][agent_end][skip] ${payload}`);
}

function logAgentEndDecision(meta: Record<string, unknown>): void {
  console.error(`[m-team][agent_end][decision] ${JSON.stringify(meta)}`);
}

function createFailResult(
  task: Task,
  payload: {
    reason: string;
    contextStep: string;
    contextOutput: Record<string, unknown>;
    previousDescription: string;
    nextDescription?: string;
    descriptionChanged: boolean;
    parseStatus: JudgeResult['parseStatus'];
    rawJudgeTail: string;
    terminalType: JudgeResult['terminalType'];
  }
): JudgeResult {
  const metrics = buildDecisionMetrics(task, payload.reason, 'fail');
  return {
    decision: 'fail',
    nextDescription: payload.nextDescription,
    contextStep: payload.contextStep,
    contextOutput: payload.contextOutput,
    reason: payload.reason,
    previousDescription: payload.previousDescription,
    descriptionChanged: payload.descriptionChanged,
    relayAttempt: metrics.relayAttempt,
    noProgressStreak: metrics.noProgressStreak,
    terminalType: payload.terminalType,
    parseStatus: payload.parseStatus,
    rawJudgeTail: payload.rawJudgeTail,
  };
}

interface JudgeParams {
  runId: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
}

interface JudgeResult {
  decision: 'complete' | 'relay' | 'fail';
  nextDescription?: string;
  contextStep: string;
  contextOutput: Record<string, unknown>;
  reason: string;
  previousDescription: string;
  descriptionChanged: boolean;
  relayAttempt: number;
  noProgressStreak: number;
  terminalType: 'system_error' | 'business_blocked' | 'normal_relay' | 'normal_complete';
  parseStatus:
    | 'ok'
    | 'llm_output_missing'
    | 'next_description_missing'
    | 'json_parse_failed'
    | 'timeout'
    | 'unknown_decision'
    | 'same_description_blocked'
    | 'reason_like_description_blocked'
    | 'repeated_no_progress_blocked';
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

  const contextText = context.length > 0
    ? context.map((ctx, i) => {
        return `[步骤 ${i}] 执行者: ${ctx.executor ?? '?'} | 步骤: ${ctx.step ?? '?'} | 输出: ${JSON.stringify(ctx.output ?? {})} | 完成时间: ${ctx.completedAt ? new Date(ctx.completedAt).toLocaleString() : '?'}`;
      }).join('\n')
    : '（无上下文）';

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

一、先判断这是“不可恢复终止”还是“可恢复纠偏”：
- 如果当前执行轮没有任何新增进展，只是在重复旧结论、重复说明缺信息、重复抱怨无法执行，而且没有可交给下一棒的明确纠偏动作 → DECISION: FAIL
- 如果 context 最近多步都在重复同一失败原因，本轮也没有打破这个模式，而且仍提不出新的可执行纠偏动作 → DECISION: FAIL
- 如果发现的是数据质量/筛选口径/约束校验问题，但存在明确补救路径（如重筛、补齐、替换不合格项、回滚到上一步重做），默认视为可恢复，不要直接 FAIL，而应输出 DECISION: RELAY
- 只有在“下一步描述”无法写成下一棒可执行动作时，才允许 FAIL

二、如果不需要终止，再判断：
- 任务目标已达成，或 context 已包含完整执行路径 → DECISION: COMPLETE
- 任务目标未达成，还需要下一步 → DECISION: RELAY

三、仅当 DECISION: RELAY 时，下一步描述必须满足：
- 动作：动词开头（继续搜索、重新筛选、补齐、替换、抓取、生成、提取）
- 目标：要操作的对象
- 条件：过滤维度或明确边界
- 数量逻辑：需要时写“补足到 N 个 / 重新找够 N 个”，禁止“前 N 个”
- 若当前问题是质量校验未通过，下一步描述必须直接写纠偏动作，不能只写失败原因

硬规则：
- “回复收到/确认收到/已阅”默认理解为在当前 session / task context / 文件中留痕确认；除非 description 或 input 明确要求外部渠道，否则不得推断为聊天平台发消息。
- REASON 只能写原因说明。
- “下一步描述”只能写下一棒 executor 的动作句，不能写失败解释、缺失条件、建议发布者补充信息之类说明文本。

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
下一步描述：<一句话描述>

或者：
DECISION: FAIL
REASON: <为什么应该终止而不是继续 relay>
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}`.trim();

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
    console.error(
      `[m-team] judgeByLlm 输出: taskId=${task.taskId} elapsed=${elapsedMs}ms ` +
      `raw="${raw.slice(0, 300)}"`
    );

    const normalized = raw.trim();
    const lastLine = normalized.split('\n').pop() ?? normalized;

    const hasComplete = /DECISION:\s*COMPLETE/i.test(normalized);
    const hasRelay = /DECISION:\s*RELAY\b/i.test(normalized);
    const hasFail = /DECISION:\s*FAIL\b/i.test(normalized);

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

    const contextStep = extractField(normalized, 'CONTEXT_STEP') || description || '执行步骤';
    const contextOutput = parseContextOutput(normalized);
    const reason = extractField(normalized, 'REASON') || 'LLM 未提供原因';

    if (hasFail) {
      console.error(
        `[m-team] judgeByLlm 判决: FAIL taskId=${task.taskId} reason="${reason.slice(0, 120)}"`
      );
      return createFailResult(task, {
        reason,
        contextStep,
        contextOutput,
        previousDescription: description || '',
        descriptionChanged: false,
        parseStatus: detectRepeatedNoProgress(task, reason) ? 'repeated_no_progress_blocked' : 'ok',
        rawJudgeTail: normalized.slice(-1000),
        terminalType: detectRepeatedNoProgress(task, reason) ? 'business_blocked' : 'system_error',
      });
    }

    if (hasComplete) {
      console.error(
        `[m-team] judgeByLlm 判决: COMPLETE taskId=${task.taskId} contextStep="${contextStep.slice(0, 80)}"`
      );
      return {
        decision: 'complete',
        contextStep,
        contextOutput,
        reason: reason || 'LLM 判定任务目标已达成',
        previousDescription: description || '',
        descriptionChanged: false,
        relayAttempt: buildDecisionMetrics(task, reason || 'LLM 判定任务目标已达成', 'complete').relayAttempt,
        noProgressStreak: 0,
        terminalType: 'normal_complete',
        parseStatus: 'ok',
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    if (hasRelay) {
      const nextDesc = nextDescription ?? description;
      const descriptionChanged = Boolean(nextDescription && nextDescription !== description);
      const parseStatus = nextDescription ? 'ok' : 'next_description_missing';

      if (nextDescription && nextDescription === description) {
        console.error(
          `[m-team] judgeByLlm 判决: RELAY-BLOCKED SAME_DESCRIPTION taskId=${task.taskId} nextDescription="${(nextDesc || '').slice(0, 80)}"`
        );
        return createFailResult(task, {
          reason: 'LLM 生成的下一步描述与当前 description 完全相同，禁止原样 relay',
          nextDescription: undefined,
          contextStep,
          contextOutput,
          previousDescription: description || '',
          descriptionChanged: false,
          parseStatus: 'same_description_blocked',
          rawJudgeTail: normalized.slice(-1000),
          terminalType: 'business_blocked',
        });
      }

      if (nextDescription && looksLikeReasonText(nextDescription)) {
        console.error(
          `[m-team] judgeByLlm 判决: RELAY-BLOCKED REASON_LIKE_DESCRIPTION taskId=${task.taskId} nextDescription="${nextDescription.slice(0, 120)}"`
        );
        return createFailResult(task, {
          reason: 'LLM 生成的下一步描述更像原因说明而非动作描述，禁止把 reason 写回 description',
          nextDescription: undefined,
          contextStep,
          contextOutput,
          previousDescription: description || '',
          descriptionChanged: false,
          parseStatus: 'reason_like_description_blocked',
          rawJudgeTail: normalized.slice(-1000),
          terminalType: 'business_blocked',
        });
      }

      if (detectRepeatedNoProgress(task, reason)) {
        console.error(
          `[m-team] judgeByLlm 判决: RELAY-BLOCKED REPEATED_NO_PROGRESS taskId=${task.taskId} reason="${reason.slice(0, 120)}"`
        );
        return createFailResult(task, {
          reason: '最近多步都在重复同一阻塞原因且无新增进展，禁止继续 relay',
          nextDescription: undefined,
          contextStep,
          contextOutput,
          previousDescription: description || '',
          descriptionChanged: false,
          parseStatus: 'repeated_no_progress_blocked',
          rawJudgeTail: normalized.slice(-1000),
          terminalType: 'business_blocked',
        });
      }

      console.error(
        `[m-team] judgeByLlm 判决: RELAY taskId=${task.taskId} changed=${descriptionChanged} ` +
        `parseStatus=${parseStatus} nextDescription="${(nextDesc || '').slice(0, 80)}"`
      );
      return {
        decision: 'relay',
        nextDescription: nextDesc,
        contextStep,
        contextOutput,
        reason: reason || 'LLM 判定任务目标未达成，需要下一棒继续',
        previousDescription: description || '',
        descriptionChanged,
        relayAttempt: buildDecisionMetrics(task, reason || 'LLM 判定任务目标未达成，需要下一棒继续', 'relay').relayAttempt,
        noProgressStreak: buildDecisionMetrics(task, reason || 'LLM 判定任务目标未达成，需要下一棒继续', 'relay').noProgressStreak,
        terminalType: 'normal_relay',
        parseStatus,
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    console.error(
      `[m-team] judgeByLlm 判决: UNKNOWN（无法解析 raw="${lastLine.slice(0, 150)}"），转 FAIL` 
    );
    api.logger?.warn(`[m-team] agent_end LLM 判断结果无法解析 "${lastLine.slice(0, 200)}"，终止任务`);
    return createFailResult(task, {
      reason: 'LLM 判决输出无法解析，禁止继续 relay',
      contextStep: description || '执行步骤',
      contextOutput: {},
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus: raw.trim() ? 'unknown_decision' : 'llm_output_missing',
      rawJudgeTail: normalized.slice(-1000),
      terminalType: 'system_error',
    });
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    const errorText = String(err);
    const parseStatus = /timeout|timed out/i.test(errorText) ? 'timeout' : 'unknown_decision';
    console.error(
      `[m-team] judgeByLlm 异常: taskId=${task.taskId} elapsed=${elapsedMs}ms error=${errorText}`
    );
    api.logger?.warn(`[m-team] agent_end LLM 判断失败: ${errorText}，终止任务`);
    return createFailResult(task, {
      reason: `LLM 判断失败：${errorText.slice(0, 300)}`,
      contextStep: description || '执行步骤',
      contextOutput: {},
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus,
      rawJudgeTail: errorText.slice(-1000),
      terminalType: 'system_error',
    });
  }
}

function extractField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseContextOutput(raw: string): Record<string, unknown> {
  const colonIdx = raw.indexOf('CONTEXT_OUTPUT:');
  if (colonIdx === -1) return {};

  const afterLabel = raw.slice(colonIdx + 'CONTEXT_OUTPUT:'.length);
  const trimmed = afterLabel.trim();
  if (!trimmed.startsWith('{')) return {};

  let depth = 0;
  let end = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) return {};

  const jsonStr = trimmed.slice(0, end);
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerAgentEndHook(api: OpenClawPluginApi): void {
  api.on('agent_end', async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => {
    const { success, error, durationMs, messages } = event;
    const { sessionKey, agentId } = ctx;

    if (!sessionKey?.startsWith('agent:')) return;
    const taskId = parseTaskId(sessionKey);
    if (!taskId) {
      logAgentEndSkip('task_id_parse_failed', {
        sessionKey,
        agentId: agentId ?? null,
        success,
        durationMs: durationMs ?? null,
        msgCount: messages?.length ?? 0,
      });
      return;
    }

    logAgentEndDecision({
      phase: 'enter',
      taskId,
      sessionKey,
      agentId: agentId ?? null,
      success,
      durationMs: durationMs ?? null,
      msgCount: messages?.length ?? 0,
    });

    const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
    const workspaceRoot: string = (pluginConfig.workspaceRoot as string) ?? '/mnt/d/code/m-team';
    const task = readTaskFile(taskId, workspaceRoot);
    if (!task) {
      logAgentEndSkip('task_file_missing', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
        workspaceRoot,
      });
      api.logger?.warn(`[m-team] agent_end: 无法读取任务 ${taskId} 的 task.json，跳过`);
      return;
    }

    if (!isExecutorSessionForTask(sessionKey, agentId ?? undefined, taskId)) {
      logAgentEndSkip('non_executor_session', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
        taskExecutor: task.executor ?? null,
      });
      return;
    }

    if ((task.status as unknown as string) !== 'running') {
      logAgentEndSkip('task_not_running', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
        taskStatus: String(task.status),
      });
      return;
    }

    if ((task.executor ?? '') !== (agentId ?? '')) {
      logAgentEndSkip('executor_mismatch', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
        taskExecutor: task.executor ?? null,
      });
      return;
    }

    if (hasTerminalLogForSession(taskId, sessionKey, workspaceRoot)) {
      logAgentEndSkip('duplicate_terminal', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
      });
      return;
    }

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
          terminalType: 'system_error',
          relayAttempt: getRelayAttempt(task),
          noProgressStreak: getNoProgressStreak(task),
          parseStatus: 'ok',
          error: errorMsg,
        },
        error: errorMsg,
      });
      if (result.task) {
        sendNotifications(
          formatFailNotifications(result.task, getNotifications()),
          api.logger ?? null
        ).catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
      }
      api.logger?.info(
        result.success
          ? `[m-team] agent_end: 任务 ${taskId} 标记失败`
          : `[m-team] agent_end: 任务 ${taskId} 无操作 (${result.reason})`
      );
      return;
    }

    const nonSystemMessages = (messages ?? []).filter((msg: unknown) => {
      const m = msg as Record<string, unknown>;
      return String(m.role ?? '') !== 'system' && extractText(m.content).trim();
    });

    if (nonSystemMessages.length === 0) {
      logAgentEndSkip('messages_empty', {
        taskId,
        sessionKey,
        agentId: agentId ?? null,
        msgCount: messages?.length ?? 0,
      });
      const result = failTask(taskId, 'AGENT_END_MESSAGES_EMPTY', undefined, {
        outcome: 'error',
        error: 'AGENT_END_MESSAGES_EMPTY',
      });
      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          reason: result.reason || 'AGENT_END_MESSAGES_EMPTY',
          decision: 'fail',
          terminalType: 'system_error',
          relayAttempt: getRelayAttempt(task),
          noProgressStreak: getNoProgressStreak(task),
          parseStatus: 'llm_output_missing',
        },
        error: 'AGENT_END_MESSAGES_EMPTY',
      });
      if (result.task) {
        sendNotifications(
          formatFailNotifications(result.task, getNotifications()),
          api.logger ?? null
        ).catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
      }
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

    if (decision.decision === 'fail') {
      if (shouldConvertFailToRecoveryRelay(task, decision)) {
        const recoveryDescription = buildRecoveryDescription(task, decision.reason, decision.contextStep);
        if (recoveryDescription && recoveryDescription !== task.description) {
          const result = relayTask(taskId, executorId, {
            step: decision.contextStep,
            output: {
              ...(decision.contextOutput ?? {}),
              summary: String((decision.contextOutput?.summary as string | undefined) ?? decision.reason),
              recoveryFrom: 'fail_to_relay',
              originalFailReason: decision.reason,
            },
          }, recoveryDescription);
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
              contextOutput: {
                ...(decision.contextOutput ?? {}),
                recoveryFrom: 'fail_to_relay',
                originalFailReason: decision.reason,
              },
              nextDescription: recoveryDescription,
              previousDescription: decision.previousDescription,
              descriptionChanged: true,
              parseStatus: 'ok',
              rawJudgeTail: decision.rawJudgeTail,
              convertedFromFail: true,
            },
          });
          console.error(
            `[m-team][agent_end] task=${taskId} decision=RELAY_FROM_FAIL previous="${(decision.previousDescription || '').slice(0, 120)}" next="${recoveryDescription.slice(0, 120)}" relaySuccess=${result.success}`
          );
          logAgentEndDecision({
            phase: 'terminal',
            taskId,
            decision: 'relay',
            terminalType: 'normal_relay',
            parseStatus: 'ok',
            relayAttempt: decision.relayAttempt + 1,
            noProgressStreak: 0,
            descriptionChanged: true,
            previousDescription: decision.previousDescription,
            nextDescription: recoveryDescription,
            relaySuccess: result.success,
            convertedFromFail: true,
            sessionKey,
            agentId: agentId ?? null,
          });
          if (result.task) {
            sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null)
              .catch(err => api.logger?.error(`[m-team] recovery relay 通知发送失败: ${String(err)}`));
          }
          return;
        }
      }

      const result = failTask(taskId, decision.reason, undefined, {
        outcome: 'blocked',
        error: decision.parseStatus,
      });
      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          reason: result.reason || decision.reason,
          decision: 'fail',
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
        `[m-team][agent_end] task=${taskId} decision=FAIL parseStatus=${decision.parseStatus} reason="${decision.reason.slice(0, 120)}"`
      );
      logAgentEndDecision({
        phase: 'terminal',
        taskId,
        decision: 'fail',
        terminalType: decision.terminalType,
        parseStatus: decision.parseStatus,
        relayAttempt: decision.relayAttempt,
        noProgressStreak: decision.noProgressStreak,
        reason: decision.reason,
        sessionKey,
        agentId: agentId ?? null,
      });
      if (result.task) {
        sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null)
          .catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
      }
      return;
    }

    if (decision.decision === 'relay') {
      const relayDescription = getRelayDescription(decision);
      const result = relayTask(taskId, executorId, {
        step: decision.contextStep,
        output: decision.contextOutput,
      }, relayDescription);
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
        `next="${(decision.nextDescription || '').slice(0, 120)}" relaySuccess=${result.success}`
      );
      logAgentEndDecision({
        phase: 'terminal',
        taskId,
        decision: 'relay',
        terminalType: decision.terminalType,
        parseStatus: decision.parseStatus,
        relayAttempt: decision.relayAttempt,
        noProgressStreak: decision.noProgressStreak,
        descriptionChanged: decision.descriptionChanged,
        previousDescription: decision.previousDescription,
        nextDescription: decision.nextDescription,
        relaySuccess: result.success,
        sessionKey,
        agentId: agentId ?? null,
      });
      if (result.task) {
        sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null)
          .catch(err => api.logger?.error(`[m-team] relay 通知发送失败: ${String(err)}`));
      }
      return;
    }

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
    logAgentEndDecision({
      phase: 'terminal',
      taskId,
      decision: 'complete',
      terminalType: decision.terminalType,
      parseStatus: decision.parseStatus,
      relayAttempt: decision.relayAttempt,
      noProgressStreak: decision.noProgressStreak,
      contextStep: decision.contextStep,
      sessionKey,
      agentId: agentId ?? null,
    });
    if (result.task) {
      sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null)
        .catch(err => api.logger?.error(`[m-team] complete 通知发送失败: ${String(err)}`));
    }
  });
}
