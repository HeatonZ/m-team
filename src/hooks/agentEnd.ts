/**
 * M-Team Hook — agent_end（链式状态机版）
 */

import type {
  OpenClawPluginApi,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
  PluginRuntime,
} from 'openclaw/plugin-sdk/core';
import {
  failTask,
  completeTask,
  relayTask,
  retainTaskOwnership,
} from '../pool/operations.js';
import { getTask } from '../pool/index.js';
import { judgeAgentEndWithLlm } from './agentEndLlm.js';
import { writeTaskLog } from '../pool/db.js';
import {
  sendNotifications,
  getNotifications,
  formatFailNotifications,
  formatRelayNotifications,
  formatTaskNotifications,
} from '../notifications.js';
import {
  LifecycleDecision,
  TaskPhase,
  type ContextStepOutput,
  type Task,
} from '../schema/task.js';

const TERMINAL_ACTIONS = new Set(['complete', 'relay', 'fail']);
const LOOP_LIMITS = {
  sameDescription: 2,
  samePhase: 3,
  noProgress: 2,
  finalizingRetain: 2,
};

function parseTaskId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  const mTeamIdx = parts.indexOf('m-team');
  if (mTeamIdx < 0 || !parts[mTeamIdx + 1]) return null;
  return parts[mTeamIdx + 1];
}

function isExecutorSessionForTask(sessionKey: string | undefined, agentId: string | undefined, taskId: string): boolean {
  if (!sessionKey || !agentId) return false;
  return sessionKey === `agent:${agentId}:m-team:${taskId}`;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        const p = part as Record<string, unknown>;
        return String(p?.text ?? p?.thinking ?? '');
      })
      .join('');
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    return String(c.text ?? c.content ?? '');
  }
  return '';
}

function assistantTexts(messages: unknown[]): string[] {
  return messages
    .map(msg => msg as Record<string, unknown>)
    .filter(msg => msg.role === 'assistant')
    .map(msg => extractText(msg.content).trim())
    .filter(Boolean)
    .filter(text => text !== 'NO_REPLY');
}

function lastAssistantText(messages: unknown[]): string {
  const texts = assistantTexts(messages);
  return texts[texts.length - 1] ?? '';
}

function fingerprint(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。,.!！?？;；:：]/g, '');
}

function inferOutput(text: string): ContextStepOutput {
  const files = [...text.matchAll(/(?:\/mnt\/[^\s,，；;。]+|[\w./-]+\.(?:json|md|csv|txt|png|jpg|webp))/g)].map(m => m[0]);
  const unresolvedIssues = [...text.matchAll(/(?:问题|缺失|未完成|待处理|需补齐|需要修正|阻塞|无法继续|报错|异常)[:：]?\s*([^\n]+)/g)].map(m => m[1].trim());
  const handoffMatch = text.match(/(?:下一步|建议)[:：]\s*([^\n]+)/i);
  return {
    summary: text.slice(0, 500),
    files: Array.from(new Set(files)).slice(0, 20),
    handoffNote: handoffMatch?.[1]?.trim(),
    unresolvedIssues: Array.from(new Set(unresolvedIssues)).slice(0, 10),
  };
}

function inferGoalSatisfied(text: string, task: Task, output: ContextStepOutput): boolean {
  const normalizedGoal = fingerprint(task.goal);
  const normalizedText = fingerprint(text);
  const goalMentionsAllItems = normalizedGoal.length > 0 && normalizedGoal.split(/\s+/).every(token => token.length < 2 || normalizedText.includes(token));
  const explicitGoalCompletion = /目标已完成|goal 已满足|已满足 goal|形成最终选品结论|全部完成|全部已输出|完整结果/i.test(text);
  const explicitMultiItemCompletion = /已完成.+并汇总输出|包含.+全部结果|三个结果|全部候选|最终结论/i.test(text);
  const finalArtifact = Boolean(output.files?.some(file => /result\.(json|md|csv|txt)$/i.test(file)));
  return explicitGoalCompletion || (explicitMultiItemCompletion && finalArtifact) || goalMentionsAllItems;
}

function isCompleteSignal(text: string, task: Task, nextDescription: string | undefined, output: ContextStepOutput): boolean {
  const normalizedDescription = fingerprint(task.description);
  const normalizedText = fingerprint(text);
  const stepCount = task.context.filter(entry => entry.type === 'step').length;
  const hasExplicitCompletionLanguage = /结果摘要|最终结果|已完成|完成如下|输出如下|任务完成/i.test(text);
  const hasIncompleteLanguage = /下一步|待处理|需补齐|未完成|继续|剩余|还需|仍需/i.test(text);
  const looksLikeSingleStepDescription = /^(计算|搜索|查找|整理|生成|上传|抓取|撰写|翻译|检查|验证|补齐|创建)\s*/.test(task.description)
    && !/[，。,；;]|并|以及|然后|后再|找够|全部|所有|最终/.test(task.description);
  const onlyRestatesCurrentStep = normalizedDescription.length > 0 && normalizedText.includes(normalizedDescription);
  const referencesExplicitArtifact = Boolean(output.files?.length) || /result\.json|\.md|\.csv|\.json|已写入|已生成|已上传/i.test(text);
  const hasStructuredOutcome = /结果摘要|最终结果|产出文件|数据引用/i.test(text);
  const canProveTerminalDelivery = referencesExplicitArtifact || /最终结果|全部完成|全部已输出|完整结果/i.test(text);
  const goalSatisfied = inferGoalSatisfied(text, task, output);

  if (!hasExplicitCompletionLanguage) return false;
  if (hasIncompleteLanguage) return false;
  if (nextDescription) return false;
  if (!hasStructuredOutcome) return false;
  if (!goalSatisfied) return false;
  if (looksLikeSingleStepDescription && stepCount === 0) return false;
  if (looksLikeSingleStepDescription && onlyRestatesCurrentStep && !referencesExplicitArtifact) return false;

  return canProveTerminalDelivery;
}

function hasExplicitRelayIntent(text: string): boolean {
  return /(?:下一步|建议)[:：]\s*[^\n]+/i.test(text);
}

function hasBlockingFailureSignal(text: string, output: ContextStepOutput): boolean {
  return /阻塞|卡住|无法继续|缺少前置|前置条件不足|权限不足|接口报错|环境异常/i.test(text)
    || Boolean(output.unresolvedIssues?.some(issue => /阻塞|无法|缺少|报错|异常|失败/i.test(issue)));
}

function isReworkSignal(text: string): boolean {
  return /重做|返工|修正|补齐|补全|移除不合格|重新筛选|重新检查/i.test(text);
}

function isFinalizingSignal(text: string): boolean {
  return /最终整理|最终核对|汇总输出|整理最终结果|收口|final/i.test(text);
}

function buildNextDescription(text: string, task: Task): string | undefined {
  const matched = text.match(/(?:下一步|建议)[:：]\s*([^\n]+)/i)?.[1]?.trim();
  if (!matched) return undefined;
  if (fingerprint(matched) === fingerprint(task.description)) return undefined;
  return matched;
}

function hasProgress(output: ContextStepOutput): boolean {
  return Boolean(
    output.summary?.trim()
    || output.files?.length
    || output.dataRefs?.length
    || output.unresolvedIssues?.length
    || (output.metrics && Object.keys(output.metrics).length > 0)
  );
}

function shouldTripLoopGuard(task: Task, nextDescription: string | undefined, output: ContextStepOutput): boolean {
  const guard = task.lifecycle.loopGuard;
  const sameDescription = nextDescription && fingerprint(nextDescription) === (guard.lastDescriptionFingerprint ?? '');
  if (sameDescription && guard.sameDescriptionCount >= LOOP_LIMITS.sameDescription) return true;
  if (!hasProgress(output) && guard.noProgressCount >= LOOP_LIMITS.noProgress) return true;
  if (guard.samePhaseCount >= LOOP_LIMITS.samePhase) return true;
  if (task.lifecycle.phase === TaskPhase.FINALIZING && task.lifecycle.lastDecision === LifecycleDecision.RETAIN && guard.samePhaseCount >= LOOP_LIMITS.finalizingRetain) return true;
  return false;
}

export function registerAgentEndHook(api: OpenClawPluginApi): void {
  api.on('agent_end', async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
    const { sessionKey, agentId } = ctx;
    const taskId = parseTaskId(sessionKey ?? '');
    if (!taskId || !isExecutorSessionForTask(sessionKey, agentId, taskId)) return;

    const task = await api.runtime.storage?.get?.<Task>(`mteam:task:${taskId}`).catch(() => null) ?? getTask(taskId) ?? null;
    if (!task) {
      api.logger?.warn?.(`[m-team] agent_end task lookup miss taskId=${taskId} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      return;
    }
    if (![TaskPhase.EXECUTING, TaskPhase.FINALIZING].includes(task.lifecycle.phase)) return;

    const nonSystemMessages = (event.messages ?? []).filter(msg => (msg as Record<string, unknown>).role !== 'system');
    if (nonSystemMessages.length === 0) {
      const result = failTask(taskId, 'AGENT_END_MESSAGES_EMPTY', null, { outcome: 'error', error: 'AGENT_END_MESSAGES_EMPTY' });
      writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'AGENT_END_MESSAGES_EMPTY' });
      if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    if (!event.success) {
      const errorMsg = event.error ?? 'unknown_error';
      const result = failTask(taskId, errorMsg, { step: '执行失败', output: { summary: errorMsg, error: errorMsg, unresolvedIssues: [errorMsg] } }, { outcome: 'error', error: errorMsg });
      writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: errorMsg });
      if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    const text = lastAssistantText(nonSystemMessages);
    const output = inferOutput(text);
    const fallbackNextDescription = buildNextDescription(text, task);
    const step = fallbackNextDescription ?? task.description;

    let llmDecision: Awaited<ReturnType<typeof judgeAgentEndWithLlm>> | null = null;
    try {
      llmDecision = await judgeAgentEndWithLlm({
        runtime: api.runtime as PluginRuntime,
        cfg: undefined,
        agentId: agentId ?? task.executor ?? 'manager',
        task,
        transcript: text,
        output,
        modelRef: process.env.MTEAM_AGENT_END_MODEL,
      });
    } catch (err) {
      api.logger?.warn?.(`[m-team] agent_end llm judge threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    const nextDescription = llmDecision?.ok
      ? (llmDecision.decision.nextDescription?.trim() || fallbackNextDescription)
      : fallbackNextDescription;

    if (llmDecision && !llmDecision.ok) {
      api.logger?.warn?.(`[m-team] agent_end llm judge fallback: ${llmDecision.error}${llmDecision.raw ? ` raw=${llmDecision.raw}` : ''}`);
    }

    if (shouldTripLoopGuard(task, nextDescription, output)) {
      const result = failTask(taskId, 'LOOP_GUARD_TRIGGERED', { step: '循环熔断', output: { ...output, error: 'LOOP_GUARD_TRIGGERED', unresolvedIssues: ['重复无进展，已熔断'] } }, { outcome: 'blocked', error: 'LOOP_GUARD_TRIGGERED' });
      writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'LOOP_GUARD_TRIGGERED' });
      if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    if (llmDecision?.ok) {
      const judged = llmDecision.decision;
      if (judged.decision === 'complete') {
        const result = completeTask(taskId, { step, output: { ...output, summary: judged.summary ?? output.summary } });
        writeTaskLog({ taskId, action: 'complete', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'complete', via: 'llm', confidence: judged.confidence } });
        if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'relay' && nextDescription) {
        const mode = judged.mode === 'reworking' || isReworkSignal(nextDescription) || output.unresolvedIssues?.length ? 'reworking' : 'handoff';
        const result = relayTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: { ...output, summary: judged.summary ?? output.summary, unresolvedIssues: judged.unresolvedIssues ?? output.unresolvedIssues } }, nextDescription, mode);
        writeTaskLog({ taskId, action: 'relay', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'relay', via: 'llm', nextDescription, mode, confidence: judged.confidence } });
        if (result.task) await sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'retain') {
        const retainDescription = nextDescription ?? judged.reason;
        const retainPhase = judged.phase === TaskPhase.FINALIZING ? TaskPhase.FINALIZING : TaskPhase.EXECUTING;
        const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output: { ...output, summary: judged.summary ?? output.summary, unresolvedIssues: judged.unresolvedIssues ?? output.unresolvedIssues } }, retainDescription, retainPhase);
        writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', via: 'llm', phase: retainPhase, confidence: judged.confidence } });
        return;
      }

      if (judged.decision === 'fail') {
        const failReason = judged.reason || 'LLM_DECIDED_FAIL';
        const result = failTask(taskId, failReason, { step: task.description, output: { ...output, summary: (judged.summary ?? text) || failReason, error: failReason, unresolvedIssues: judged.unresolvedIssues?.length ? judged.unresolvedIssues : (output.unresolvedIssues?.length ? output.unresolvedIssues : [failReason]) } }, { outcome: 'blocked', error: failReason });
        writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'llm', confidence: judged.confidence }, error: failReason });
        if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }
    }

    if (isCompleteSignal(text, task, nextDescription, output)) {
      const result = completeTask(taskId, { step, output });
      writeTaskLog({ taskId, action: 'complete', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'complete' } });
      if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    if (isFinalizingSignal(text) && hasProgress(output)) {
      const retainDescription = nextDescription ?? '整理当前结果并做最终核对，确认满足 goal 后完成任务。';
      const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output }, retainDescription, TaskPhase.FINALIZING);
      writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', phase: 'finalizing' } });
      return;
    }

    if (nextDescription) {
      const mode = isReworkSignal(nextDescription) || output.unresolvedIssues?.length ? 'reworking' : 'handoff';
      const result = relayTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output }, nextDescription, mode);
      writeTaskLog({ taskId, action: 'relay', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'relay', nextDescription, mode } });
      if (result.task) await sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    if (hasExplicitRelayIntent(text) && !nextDescription) {
      const retainDescription = task.lifecycle.phase === TaskPhase.FINALIZING
        ? '把下一步写成明确单步 description，再决定是否交接。'
        : '把下一步写成明确单步 description，再继续执行或交接。';
      const retainPhase = task.lifecycle.phase === TaskPhase.FINALIZING ? TaskPhase.FINALIZING : TaskPhase.EXECUTING;
      const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output }, retainDescription, retainPhase);
      writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', phase: retainPhase, reason: 'AMBIGUOUS_RELAY_WITHOUT_NEXT_DESCRIPTION' } });
      return;
    }

    if (hasProgress(output)) {
      if (hasBlockingFailureSignal(text, output) && !nextDescription) {
        const result = failTask(taskId, 'BLOCKED_WITH_PROGRESS_BUT_NO_HANDOFF', { step: task.description, output: { ...output, summary: text || '阻塞且已有中间结果，但未形成可交接下一步', error: 'BLOCKED_WITH_PROGRESS_BUT_NO_HANDOFF', unresolvedIssues: output.unresolvedIssues?.length ? output.unresolvedIssues : ['阻塞且未形成明确下一步'] } }, { outcome: 'blocked', error: 'BLOCKED_WITH_PROGRESS_BUT_NO_HANDOFF' });
        writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'BLOCKED_WITH_PROGRESS_BUT_NO_HANDOFF' });
        if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      const retainDescription = task.lifecycle.phase === TaskPhase.FINALIZING
        ? '继续完成当前最终收口动作，补齐最终输出后完成任务。'
        : task.description;
      const retainPhase = task.lifecycle.phase === TaskPhase.FINALIZING ? TaskPhase.FINALIZING : TaskPhase.EXECUTING;
      const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output }, retainDescription, retainPhase);
      writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', phase: retainPhase } });
      return;
    }

    if (hasBlockingFailureSignal(text, output)) {
      const result = failTask(taskId, 'BLOCKED_WITHOUT_HANDOFF', { step: task.description, output: { ...output, summary: text || '阻塞且缺少可交接下一步', error: 'BLOCKED_WITHOUT_HANDOFF', unresolvedIssues: output.unresolvedIssues?.length ? output.unresolvedIssues : ['阻塞且未形成明确下一步'] } }, { outcome: 'blocked', error: 'BLOCKED_WITHOUT_HANDOFF' });
      writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'BLOCKED_WITHOUT_HANDOFF' });
      if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    const result = failTask(taskId, 'NO_RECOVERABLE_PROGRESS', { step: '无有效进展', output: { summary: text || '无有效进展', error: 'NO_RECOVERABLE_PROGRESS', unresolvedIssues: ['没有新增可交接结果'] } }, { outcome: 'blocked', error: 'NO_RECOVERABLE_PROGRESS' });
    writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'NO_RECOVERABLE_PROGRESS' });
    if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
  });
}
