/**
 * M-Team Hook — agent_end（LLM-first 裁决版）
 */

import type {
  OpenClawPluginApi,
  PluginRuntime,
} from 'openclaw/plugin-sdk/core';
import type { PluginHookAgentEndEvent, PluginHookAgentContext } from '../types/openclaw-hooks.js';
import {
  failTask,
  completeTask,
  nextTask,
} from '../pool/operations.js';
import { getTask } from '../pool/index.js';
import { judgeAgentEndWithLlm } from './agentEndLlm.js';
import { writeTaskLog } from '../pool/db.js';
import {
  sendNotifications,
  getNotifications,
  formatFailNotifications,
  formatNextNotifications,
  formatTaskNotifications,
} from '../notifications.js';
import { TaskStatus, type ContextStepOutput, type Task } from '../schema/task.js';

type RuntimeWithTaskStorage = PluginRuntime & {
  storage?: {
    get?: <T>(key: string) => Promise<T | null>;
  };
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

function hasProblemReportSignal(text: string, output: ContextStepOutput): boolean {
  const combined = [text, ...(output.unresolvedIssues ?? [])].join('\n');
  return /补齐|修复|重试|核对|检查|校验|重新生成|重新运行|补充|完善|排查|缺少|待补|需补|问题|阻塞/i.test(combined);
}

function buildConservativeNextDescription(task: Task): string {
  return `继续处理当前任务“${task.description}”中已报告的问题，完成一个清晰、可验证的下一步结果，并继续如实汇报产物与剩余问题。`;
}

type ProblemKind =
  | 'missing_artifact'
  | 'missing_evidence'
  | 'quality_gap'
  | 'blocked_by_permission'
  | 'blocked_by_external_input'
  | 'needs_other_skill'
  | 'incomplete_step'
  | 'generic_problem';

function classifyProblem(task: Task, text: string, output: ContextStepOutput): {
  kind: ProblemKind;
  blocking: boolean;
  summary: string;
} {
  const joined = `${text}\n${(output.unresolvedIssues ?? []).join('\n')}`.trim();
  const summary = (output.unresolvedIssues?.[0] ?? output.summary ?? joined ?? task.description).trim() || task.description;
  if (/权限不足|无权限|permission/i.test(joined)) return { kind: 'blocked_by_permission', blocking: true, summary };
  if (/缺少前置|前置条件不足|需要外部输入|等待外部|缺少数据源|缺少素材/i.test(joined)) return { kind: 'blocked_by_external_input', blocking: true, summary };
  if (/需要测试|需要设计|需要研究|需要调研|需要运维|需要人工验收/i.test(joined)) return { kind: 'needs_other_skill', blocking: false, summary };
  if (/文件不存在|缺少文件|未生成文件|缺失产物/i.test(joined)) return { kind: 'missing_artifact', blocking: false, summary };
  if (/缺少证据|无法验证|未校验|缺少截图|缺少证明/i.test(joined)) return { kind: 'missing_evidence', blocking: false, summary };
  if (/质量不达标|结果不完整|字段缺失|数据不全/i.test(joined)) return { kind: 'quality_gap', blocking: false, summary };
  if (/未完成|待补齐|需补齐|还需继续|还差|继续处理/i.test(joined)) return { kind: 'incomplete_step', blocking: false, summary };
  return { kind: 'generic_problem', blocking: hasExplicitBlocker(text, output), summary };
}

function buildNextDescriptionFromProblem(task: Task, problem: { kind: ProblemKind; blocking: boolean; summary: string }): string {
  switch (problem.kind) {
    case 'missing_artifact':
      return `补齐当前任务“${task.description}”缺失的产物文件，并重新提交可验证结果。问题：${problem.summary}`;
    case 'missing_evidence':
      return `补充当前任务“${task.description}”缺失的验证证据，并重新提交可验收结果。问题：${problem.summary}`;
    case 'quality_gap':
      return `修正当前任务“${task.description}”中不完整或不达标的结果，并重新输出可验证产物。问题：${problem.summary}`;
    case 'blocked_by_permission':
      return `处理当前任务“${task.description}”所需的权限或访问阻塞，补齐可执行前置后再继续推进。问题：${problem.summary}`;
    case 'blocked_by_external_input':
      return `补齐当前任务“${task.description}”缺失的外部输入或前置条件，确认输入可用后再继续推进。问题：${problem.summary}`;
    case 'needs_other_skill':
      return `继续推进当前任务“${task.description}”的下一步专业处理动作，并补齐本轮报告问题。问题：${problem.summary}`;
    case 'incomplete_step':
      return `继续完成当前任务“${task.description}”尚未完成的部分，补齐缺口后重新提交结果。问题：${problem.summary}`;
    default:
      return `继续围绕当前任务“${task.description}”中本轮报告的问题推进下一步处理动作，并补齐可验证结果。问题：${problem.summary}`;
  }
}

function decideConservativeFallback(task: Task, text: string, output: ContextStepOutput): {
  decision: 'next' | 'fail';
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
    const problem = classifyProblem(task, text, output);
    return {
      decision: 'next',
      reason: 'LLM_UNAVAILABLE_WITH_PARTIAL_PROGRESS',
      description: buildNextDescriptionFromProblem(task, problem),
    };
  }

  if (hasProblemReportSignal(text, output)) {
    const problem = classifyProblem(task, text, output);
    return {
      decision: 'next',
      reason: 'LLM_UNAVAILABLE_BUT_PROBLEM_REPORTED',
      description: buildNextDescriptionFromProblem(task, problem),
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

    const runtime = api.runtime as RuntimeWithTaskStorage;
    const task = await runtime.storage?.get?.<Task>(`mteam:task:${taskId}`).catch(() => null) ?? getTask(taskId) ?? null;
    if (!task) {
      api.logger?.warn?.(`[m-team] agent_end task lookup miss taskId=${taskId} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      return;
    }
    if (task.status !== TaskStatus.RUNNING) return;

    const nonSystemMessages = (event.messages ?? []).filter((msg: unknown) => (msg as Record<string, unknown>).role !== 'system');
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

      if (judged.decision === 'next') {
        const nextDescription = judged.nextDescription!.trim();
        const result = nextTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: { ...normalizedOutput, summary: judged.summary ?? normalizedOutput.summary, unresolvedIssues: judged.unresolvedIssues ?? normalizedOutput.unresolvedIssues } }, nextDescription);
        writeTaskLog({ taskId, action: 'next', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'next', via: 'llm', nextDescription, confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        if (result.task) await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
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
    if (fallback.decision === 'next') {
      const result = nextTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: normalizedOutput }, fallback.description ?? buildConservativeNextDescription(task));
      writeTaskLog({ taskId, action: 'next', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'next', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
      if (result.task) await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    const result = failTask(taskId, fallback.reason, { step: task.description, output: { ...normalizedOutput, summary: text || fallback.reason, error: fallback.reason, unresolvedIssues: normalizedOutput.unresolvedIssues?.length ? normalizedOutput.unresolvedIssues : [fallback.reason] } }, { outcome: 'blocked', error: fallback.reason });
    writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } }, error: fallback.reason });
    if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
  });
}
