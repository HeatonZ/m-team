/**
 * M-Team Hook — agent_end（LLM-first 裁决版）
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
  TaskPhase,
  type ContextStepOutput,
  type Task,
} from '../schema/task.js';

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

function inferOutput(text: string): ContextStepOutput {
  const normalizedText = text.trim();
  const files = [...normalizedText.matchAll(/(?:\/mnt\/[^\s,，；;。]+|[\w./-]+\.(?:json|md|csv|txt|png|jpg|webp))/g)].map(m => m[0]);
  const unresolvedIssues = [...normalizedText.matchAll(/(?:问题|缺失|未完成|待处理|需补齐|需要修正|阻塞|无法继续|报错|异常)[:：]?\s*([^\n]+)/g)].map(m => m[1].trim());

  const cleanFiles = Array.from(new Set(files)).slice(0, 20);
  const cleanIssues = Array.from(new Set(unresolvedIssues)).slice(0, 10);
  const hasNonTrivialSummary = normalizedText.length >= 12 && !/^NO_REPLY$/i.test(normalizedText);

  return {
    summary: hasNonTrivialSummary ? normalizedText.slice(0, 500) : undefined,
    files: cleanFiles,
    unresolvedIssues: cleanIssues,
    error: cleanIssues[0],
  };
}

function hasPositiveProgressSignal(text: string, output: ContextStepOutput): boolean {
  return Boolean(
    output.files?.length
    || output.dataRefs?.length
    || (output.metrics && Object.keys(output.metrics).length > 0)
    || /结果摘要|已整理|已完成|已记录|已生成|已输出|已保存|产出|文件|结果为|记录在/i.test(text)
  );
}

function hasStructuredProgress(output: ContextStepOutput, text: string): boolean {
  return Boolean(
    hasPositiveProgressSignal(text, output)
    || Boolean(output.summary?.trim()) && !hasExplicitBlocker(text, output)
  );
}

function hasOnlyBlockerSignal(text: string, output: ContextStepOutput): boolean {
  return hasExplicitBlocker(text, output) && !hasPositiveProgressSignal(text, output);
}

function hasExplicitBlocker(text: string, output: ContextStepOutput): boolean {
  return /阻塞|卡住|无法继续|缺少前置|前置条件不足|权限不足|接口报错|环境异常|失败/i.test(text)
    || Boolean(output.unresolvedIssues?.some(issue => /阻塞|无法|缺少|报错|异常|失败/i.test(issue)));
}

function buildConservativeRetainDescription(task: Task): string {
  return `继续补齐当前步骤“${task.description}”的结构化结果，并明确是否满足 goal；若需交接，请给出下一棒单步 description。`;
}

function decideConservativeFallback(task: Task, text: string, output: ContextStepOutput): {
  decision: 'retain' | 'fail';
  reason: string;
  description?: string;
} {
  if (!text.trim() && !hasStructuredProgress(output, text)) {
    return {
      decision: 'fail',
      reason: 'LLM_UNAVAILABLE_AND_NO_PROGRESS',
    };
  }

  if (hasOnlyBlockerSignal(text, output)) {
    return {
      decision: 'fail',
      reason: 'LLM_UNAVAILABLE_AND_BLOCKED',
    };
  }

  if (hasStructuredProgress(output, text)) {
    return {
      decision: 'retain',
      reason: 'LLM_UNAVAILABLE_WITH_PARTIAL_PROGRESS',
      description: buildConservativeRetainDescription(task),
    };
  }

  return {
    decision: 'fail',
    reason: 'LLM_UNAVAILABLE_AND_NO_RECOVERABLE_PROGRESS',
  };
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
    const normalizedOutput: ContextStepOutput = {
      summary: output.summary,
      files: output.files ?? [],
      unresolvedIssues: output.unresolvedIssues ?? [],
      error: output.error,
    };
    const step = task.description;

    let llmDecision: Awaited<ReturnType<typeof judgeAgentEndWithLlm>> | null = null;
    try {
      llmDecision = await judgeAgentEndWithLlm({
        runtime: api.runtime as PluginRuntime,
        cfg: undefined,
        agentId: agentId ?? task.executor ?? 'manager',
        task,
        transcript: text,
        output: normalizedOutput,
        modelRef: process.env.MTEAM_AGENT_END_MODEL,
      });
    } catch (err) {
      api.logger?.warn?.(`[m-team] agent_end llm judge threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (llmDecision?.ok) {
      const judged = llmDecision.decision;

      if (judged.decision === 'complete') {
        const result = completeTask(taskId, { step, output: { ...normalizedOutput, summary: judged.summary ?? normalizedOutput.summary, unresolvedIssues: judged.unresolvedIssues ?? normalizedOutput.unresolvedIssues } });
        writeTaskLog({ taskId, action: 'complete', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'complete', via: 'llm', confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'relay') {
        const nextDescription = judged.nextDescription!.trim();
        const result = relayTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: { ...normalizedOutput, summary: judged.summary ?? normalizedOutput.summary, unresolvedIssues: judged.unresolvedIssues ?? normalizedOutput.unresolvedIssues } }, nextDescription, 'handoff');
        writeTaskLog({ taskId, action: 'relay', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'relay', via: 'llm', nextDescription, confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        if (result.task) await sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'retain') {
        const retainDescription = judged.reason.trim() || buildConservativeRetainDescription(task);
        const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output: { ...normalizedOutput, summary: judged.summary ?? normalizedOutput.summary, unresolvedIssues: judged.unresolvedIssues ?? normalizedOutput.unresolvedIssues } }, retainDescription, TaskPhase.EXECUTING);
        writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', via: 'llm', confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        return;
      }

      if (judged.decision === 'fail') {
        const failReason = judged.reason || 'LLM_DECIDED_FAIL';
        const result = failTask(taskId, failReason, { step: task.description, output: { ...normalizedOutput, summary: (judged.summary ?? text) || failReason, error: failReason, unresolvedIssues: judged.unresolvedIssues?.length ? judged.unresolvedIssues : (normalizedOutput.unresolvedIssues?.length ? normalizedOutput.unresolvedIssues : [failReason]) } }, { outcome: 'blocked', error: failReason });
        writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'llm', confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } }, error: failReason });
        if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }
    }

    if (llmDecision && !llmDecision.ok) {
      api.logger?.warn?.(`[m-team] agent_end llm judge fallback: ${llmDecision.error}${llmDecision.raw ? ` raw=${llmDecision.raw}` : ''}`);
    }

    const fallback = decideConservativeFallback(task, text, output);
    if (fallback.decision === 'retain') {
      const result = retainTaskOwnership(taskId, agentId ?? task.executor ?? 'unknown', { step, output: normalizedOutput }, fallback.description ?? buildConservativeRetainDescription(task), TaskPhase.EXECUTING);
      writeTaskLog({ taskId, action: 'retain', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'retain', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
      return;
    }

    const result = failTask(taskId, fallback.reason, { step: task.description, output: { ...normalizedOutput, summary: text || fallback.reason, error: fallback.reason, unresolvedIssues: normalizedOutput.unresolvedIssues?.length ? normalizedOutput.unresolvedIssues : [fallback.reason] } }, { outcome: 'blocked', error: fallback.reason });
    writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } }, error: fallback.reason });
    if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
  });
}
