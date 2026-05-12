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
  const unresolvedIssues = [...normalizedText.matchAll(/(?:问题|缺失|未完成|待处理|需补齐|需要修正|阻塞|无法继续|报错|异常)[:：]?\s*([^\n]+)/g)]
    .map(m => m[1].trim())
    .filter(issue => {
      if (!issue) return false;
      if (/^(\*+)?\s*无未解决问题/i.test(issue)) return false;
      if (/^\*+$/.test(issue)) return false;
      if (/^[-–—\s*.]+$/.test(issue)) return false;
      if (/等待\s*(publisher|manager).*关闭/i.test(issue)) return false;
      if (/等待\s*agent_end\s*裁决/i.test(issue)) return false;
      return true;
    });

  const cleanFiles = Array.from(new Set(files)).slice(0, 20);
  const cleanIssues = Array.from(new Set(unresolvedIssues)).slice(0, 10);
  const hasNonTrivialSummary = normalizedText.length >= 12 && !/^NO_REPLY$/i.test(normalizedText);

  return {
    summary: hasNonTrivialSummary ? normalizedText.slice(0, 500) : undefined,
    files: cleanFiles,
    unresolvedIssues: cleanIssues,
    error: cleanIssues.find(issue => /阻塞|无法|缺少|报错|异常|失败/i.test(issue)),
  };
}

function stripGoalLevelLines(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/goal已达成|整体完成|整任务完成|等待\s*publisher|验收关闭|close_task|publisher.*关闭|仅有publisher|只有publisher|agent_end 裁决|等待 agent_end/i.test(line))
    .join('\n')
    .trim();
  return cleaned || undefined;
}

function sanitizeStoredOutput(output: ContextStepOutput): ContextStepOutput {
  const summary = stripGoalLevelLines(output.summary);
  const unresolvedIssues = (output.unresolvedIssues ?? [])
    .map(issue => stripGoalLevelLines(issue))
    .filter((issue): issue is string => Boolean(issue))
    .filter(issue => !/^(\*+)?\s*无(?:执行层)?未解决问题/i.test(issue));
  const error = output.error && unresolvedIssues.includes(output.error) ? output.error : undefined;
  return {
    ...output,
    summary,
    unresolvedIssues,
    error,
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

function parseExplicitNextStep(text: string): string | null {
  const patterns = [
    /下一步[：:]\s*([^\n]+)/i,
    /等待(?:\s*next|\s*下一步)?[（(]([^()\n]{4,200})[)）]/i,
    /继续到下一步[：:]\s*([^\n]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const next = match[1].trim().replace(/^[-–—:\s]+/, '');
      if (next && !/^无未解决问题/.test(next)) return next;
    }
  }
  return null;
}

function isConciseCurrentStepDescription(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length > 120) return false;
  if (/当前任务|本轮报告|继续围绕|问题：|结果摘要|产出文件|未解决问题|agent_end/i.test(normalized)) return false;
  return true;
}

function sanitizeStepInstruction(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^继续围绕当前任务[“"].*?[”"]/, '').trim();
  text = text.replace(/^问题[：:]\s*/, '').trim();
  text = text.replace(/[。；;，,]\s*问题[：:].*$/u, '').trim();
  text = text.replace(/[。；;，,]\s*继续如实汇报.*$/u, '').trim();
  text = text.replace(/^[-–—:\s]+/, '').trim();
  if (!text) return '';
  return text.length > 120 ? text.slice(0, 120) : text;
}

function buildConservativeNextDescription(task: Task): string {
  return sanitizeStepInstruction(task.description) || task.description;
}

function collectKnownFiles(task: Task, output: ContextStepOutput): string[] {
  const files = new Set<string>(output.files ?? []);
  for (const entry of task.context) {
    for (const file of entry.output?.files ?? []) files.add(file);
  }
  return [...files];
}

function shouldAutoCompleteForAcceptance(task: Task, text: string, output: ContextStepOutput): boolean {
  if (hasExplicitBlocker(text, output)) return false;
  const combined = `${task.description}\n${text}\n${output.summary ?? ''}\n${(output.unresolvedIssues ?? []).join('\n')}`;
  const asksPublisherClose = /publisher|manager|验收|关闭|close_task|mteam_close_task/i.test(combined);
  const doneSignal = /goal已达成|任务已完成|最终结果|汇总结果|等待\s*publisher|验收关闭/i.test(combined);
  const knownFiles = collectKnownFiles(task, output);
  const hasFinalArtifact = knownFiles.some(file => /final|result/i.test(file));
  return asksPublisherClose && doneSignal && hasFinalArtifact;
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
  const base = sanitizeStepInstruction(task.description) || task.description;
  switch (problem.kind) {
    case 'missing_artifact':
      return `补齐缺失的产物文件，并重新提交可验证结果`;
    case 'missing_evidence':
      return `补充缺失的验证证据，并重新提交可验收结果`;
    case 'quality_gap':
      return `修正不完整或不达标的结果，并重新输出可验证产物`;
    case 'blocked_by_permission':
      return `处理权限或访问阻塞，补齐可执行前置后再继续推进`;
    case 'blocked_by_external_input':
      return `补齐缺失的外部输入或前置条件，确认输入可用后再继续推进`;
    case 'needs_other_skill':
      return `继续执行下一步专业处理动作`;
    case 'incomplete_step':
      return `继续完成当前步骤尚未完成的部分`;
    default:
      return base;
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
    const hintedNext = parseExplicitNextStep(text);
    if (hintedNext) {
      return {
        decision: 'next',
        reason: 'LLM_UNAVAILABLE_WITH_EXPLICIT_NEXT_STEP',
        description: hintedNext,
      };
    }
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
    const storedOutput = sanitizeStoredOutput(normalizedOutput);
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
        const result = completeTask(taskId, { step, output: sanitizeStoredOutput({ ...storedOutput, summary: stripGoalLevelLines(judged.summary) ?? storedOutput.summary, unresolvedIssues: (judged.unresolvedIssues ?? storedOutput.unresolvedIssues) }) });
        writeTaskLog({ taskId, action: 'complete', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'complete', via: 'llm', confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'next') {
        const explicitNext = parseExplicitNextStep(text);
        const llmNext = judged.nextDescription!.trim();
        const nextDescription = explicitNext
          ?? (isConciseCurrentStepDescription(llmNext) ? llmNext : buildConservativeNextDescription(task));
        const result = nextTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: sanitizeStoredOutput({ ...storedOutput, summary: stripGoalLevelLines(judged.summary) ?? storedOutput.summary, unresolvedIssues: judged.unresolvedIssues ?? storedOutput.unresolvedIssues }) }, nextDescription);
        writeTaskLog({ taskId, action: 'next', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'next', via: 'llm', nextDescription, confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
        if (result.task) await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'fail') {
        const failReason = judged.reason || 'LLM_DECIDED_FAIL';
        const result = failTask(taskId, failReason, { step: task.description, output: sanitizeStoredOutput({ ...storedOutput, summary: stripGoalLevelLines((judged.summary ?? text) || failReason), error: failReason, unresolvedIssues: judged.unresolvedIssues?.length ? judged.unresolvedIssues : (storedOutput.unresolvedIssues?.length ? storedOutput.unresolvedIssues : [failReason]) }) }, { outcome: 'blocked', error: failReason });
        writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'llm', confidence: judged.confidence, reason: judged.reason, llm_raw: llmDecision.raw, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } }, error: failReason });
        if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }
    }

    if (llmDecision && !llmDecision.ok) {
      api.logger?.warn?.(`[m-team] agent_end llm judge fallback: ${llmDecision.error}${llmDecision.raw ? ` raw=${llmDecision.raw}` : ''}`);
    }

    if (shouldAutoCompleteForAcceptance(task, text, normalizedOutput)) {
      const result = completeTask(taskId, {
        step,
        output: sanitizeStoredOutput({
          ...storedOutput,
          summary: stripGoalLevelLines(storedOutput.summary ?? text),
          unresolvedIssues: [],
          error: undefined,
        })
      });
      writeTaskLog({
        taskId,
        action: 'complete',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          decision: 'complete',
          via: 'publisher_acceptance_heuristic',
          evidence: {
            summary: normalizedOutput.summary ?? '',
            files: normalizedOutput.files ?? [],
            unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
            error: normalizedOutput.error ?? null,
          }
        }
      });
      if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    const fallback = decideConservativeFallback(task, text, output);
    if (fallback.decision === 'next') {
      const result = nextTask(taskId, agentId ?? task.executor ?? 'unknown', { step, output: storedOutput }, fallback.description ?? buildConservativeNextDescription(task));
      writeTaskLog({ taskId, action: 'next', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'next', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } } });
      if (result.task) await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    const result = failTask(taskId, fallback.reason, { step: task.description, output: sanitizeStoredOutput({ ...storedOutput, summary: stripGoalLevelLines(text || fallback.reason), error: fallback.reason, unresolvedIssues: storedOutput.unresolvedIssues?.length ? storedOutput.unresolvedIssues : [fallback.reason] }) }, { outcome: 'blocked', error: fallback.reason });
    writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail', via: 'conservative_fallback', reason: fallback.reason, llm_raw: llmDecision?.raw ?? null, evidence: { summary: normalizedOutput.summary ?? '', files: normalizedOutput.files ?? [], unresolvedIssues: normalizedOutput.unresolvedIssues ?? [], error: normalizedOutput.error ?? null } }, error: fallback.reason });
    if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
  });
}
