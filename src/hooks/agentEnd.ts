import type {
  OpenClawConfig,
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

const DEFAULT_AGENT_END_JUDGE_TIMEOUT_MS = 90_000;

type RuntimeWithTaskStorage = PluginRuntime & {
  storage?: {
    get?: <T>(key: string) => Promise<T | null>;
  };
};

type AgentEndJudgeResult = Awaited<ReturnType<typeof judgeAgentEndWithLlm>>;

function getRuntimeConfig(runtime: PluginRuntime | RuntimeWithTaskStorage | undefined): OpenClawConfig | undefined {
  try {
    return runtime?.config?.current?.() as OpenClawConfig | undefined;
  } catch {
    return undefined;
  }
}

function parseTaskId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  const mTeamIdx = parts.indexOf('m-team');
  if (mTeamIdx < 0 || !parts[mTeamIdx + 1]) return null;
  return parts[mTeamIdx + 1];
}

function isExecutorSessionForTask(sessionKey: string | undefined, agentId: string | undefined, taskId: string): boolean {
  if (!sessionKey || !agentId) return false;
  const prefix = `agent:${agentId}:m-team:${taskId}:`;
  return sessionKey.startsWith(prefix);
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

function normalizeIssueLine(issue: string | undefined): string {
  return String(issue ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*`#>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonIssueLine(issue: string | undefined): boolean {
  const normalized = normalizeIssueLine(issue);
  if (!normalized) return true;
  if (/^[.:,;!?()[\]{}'"“”‘’\s-]+$/.test(normalized)) return true;
  if (/^(none|n\/a|无|无未解决问题)$/iu.test(normalized)) return true;
  if (/^(unresolved issues?|issues?)[:：]?\s*(none|n\/a|无)$/iu.test(normalized)) return true;
  if (/^(未解决问题|问题|阻塞问题)[:：]?\s*(无|none|n\/a)$/iu.test(normalized)) return true;
  if (/^no (blocking |unresolved )?issues?$/i.test(normalized)) return true;
  if (/(等待|wait(?:ing)? for).*(agent_end|publisher|manager)/iu.test(normalized)) return true;
  if (/(当前步骤已完成|step completed|execution finished).*(等待|wait(?:ing)?)/iu.test(normalized)) return true;
  if (/^issue\b/i.test(normalized) && /\b(no|none)\b/i.test(normalized)) return true;
  return false;
}

function inferOutput(text: string): ContextStepOutput {
  const normalizedText = text.trim();
  const files = [...normalizedText.matchAll(/(?:\/mnt\/[^\s,;:!?，。；：\]]+|[a-zA-Z]:\\[^\s,;:!?，。；：\]]+|[\w./-]+\.(?:json|md|csv|txt|png|jpg|jpeg|webp|log))/g)]
    .map(m => m[0].trim());

  const lines = normalizedText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const issueFromHeader = lines.flatMap((line) => {
    const match = line.match(/^(?:未解决问题|阻塞问题|问题|Unresolved issues?|Issues?)\s*[:：]\s*(.+)$/iu);
    if (!match?.[1]) return [];
    return match[1]
      .split(/[；;、，,|]/)
      .map(item => item.trim())
      .filter(Boolean);
  });

  const issueFromSignals = lines
    .filter(line => /(阻塞|无法|失败|错误|异常|缺少|待补|missing|failed|error|blocked|blocker|permission)/iu.test(line))
    .map(line => line.replace(/^[-*•]+\s*/, '').trim());

  const issueMatches = [...issueFromHeader, ...issueFromSignals]
    .filter(item => !isNonIssueLine(item));

  const cleanFiles = Array.from(new Set(files)).slice(0, 20);
  const cleanIssues = Array.from(new Set(issueMatches)).slice(0, 10);
  const hasNonTrivialSummary = normalizedText.length >= 12 && !/^NO_REPLY$/i.test(normalizedText);

  return {
    summary: hasNonTrivialSummary ? normalizedText.slice(0, 500) : undefined,
    files: cleanFiles,
    unresolvedIssues: cleanIssues,
    error: cleanIssues.find(issue => /(blocked|blocker|permission|failed|error|阻塞|无法|失败|错误|异常)/iu.test(issue)),
  };
}

function stripGoalLevelLines(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/(goal.*(reached|completed)|整体任务(已)?完成|任务(已)?完成|等待\s*(publisher|agent_end)|close_task|only\s+publisher|仅由\s*publisher|只有\s*publisher)/iu.test(line))
    .join('\n')
    .trim();
  return cleaned || undefined;
}

function sanitizeStoredOutput(output: ContextStepOutput): ContextStepOutput {
  const summary = stripGoalLevelLines(output.summary);
  const unresolvedIssues = Array.from(new Set(
    (output.unresolvedIssues ?? [])
      .map(issue => stripGoalLevelLines(issue))
      .filter((issue): issue is string => Boolean(issue))
      .filter(issue => !isNonIssueLine(issue))
      .map(issue => normalizeIssueLine(issue))
      .filter(Boolean)
  )).slice(0, 10);
  const error = output.error && unresolvedIssues.some(issue => normalizeIssueLine(issue) === normalizeIssueLine(output.error)) ? output.error : undefined;
  return {
    ...output,
    summary,
    unresolvedIssues,
    error,
  };
}

function hasNoRealIssues(output: ContextStepOutput): boolean {
  const issues = (output.unresolvedIssues ?? []).filter(issue => !isNonIssueLine(issue));
  return issues.length === 0 && !output.error;
}

function hasProblemReportSignal(text: string, output: ContextStepOutput): boolean {
  const combined = [text, ...(output.unresolvedIssues ?? [])].join('\n');
  return /(补齐|修复|重试|校对|检查|校验|重新生成|重新运行|补充|完善|排查|缺少|待补|阻塞|fix|retry|verify|missing|blocked|blocker)/iu.test(combined);
}

function buildConservativeNextDescription(task: Task): string {
  return sanitizeStepInstruction(task.description) || task.description;
}

function isSameCurrentStepDescription(task: Task, nextDescription: string): boolean {
  const current = sanitizeStepInstruction(task.description);
  const next = sanitizeStepInstruction(nextDescription);
  return Boolean(current && next && current === next);
}

function parseExplicitNextStep(text: string): string | null {
  const patterns = [
    /下一步[:：]\s*([^\n]+)/iu,
    /继续到下一步[:：]\s*([^\n]+)/iu,
    /next step[:：]?\s*([^\n]+)/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const next = match[1].trim().replace(/^[-—–•\s]+/u, '');
      if (next && !/^(无未解决问题|none)$/iu.test(next)) return next;
    }
  }
  return null;
}

function isConciseCurrentStepDescription(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length > 120) return false;
  if (/(当前任务|本轮报告|继续围绕|问题[:：]|结果摘要|产出文件|未解决问题|agent_end)/iu.test(normalized)) return false;
  return true;
}

function sanitizeStepInstruction(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^继续围绕当前任务["“”'].*?["“”']/u, '').trim();
  text = text.replace(/^问题[:：]\s*/u, '').trim();
  text = text.replace(/[。；;，,]\s*问题[:：].*$/u, '').trim();
  text = text.replace(/[。；;，,]\s*继续如实汇报.*$/u, '').trim();
  text = text.replace(/^[-—–•\s]+/u, '').trim();
  return text.length > 120 ? text.slice(0, 120) : text;
}

function buildLlmLogData(llmDecision: AgentEndJudgeResult | null): Record<string, unknown> | null {
  if (!llmDecision) return null;
  if (!llmDecision.ok) {
    return {
      source: 'llm',
      status: 'error',
      error: llmDecision.error,
      raw: llmDecision.raw ?? null,
    };
  }
  return {
    source: 'llm',
    status: 'ok',
    raw: llmDecision.raw ?? null,
    parsed: {
      decision: llmDecision.decision.decision,
      reason: llmDecision.decision.reason,
      confidence: llmDecision.decision.confidence,
      nextDescription: llmDecision.decision.nextDescription ?? null,
      nextTaskType: llmDecision.decision.nextTaskType ?? null,
      summary: llmDecision.decision.summary ?? null,
      unresolvedIssues: llmDecision.decision.unresolvedIssues ?? [],
    },
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
      const result = failTask(taskId, 'AGENT_END_MESSAGES_EMPTY', {
        step: task.description,
        output: {
          summary: 'AGENT_END_MESSAGES_EMPTY',
          error: 'AGENT_END_MESSAGES_EMPTY',
          unresolvedIssues: ['AGENT_END_MESSAGES_EMPTY'],
        },
      });
      writeTaskLog({ taskId, action: 'fail', sessionKey: sessionKey ?? undefined, agentId: agentId ?? undefined, result: { success: result.success, decision: 'fail' }, error: 'AGENT_END_MESSAGES_EMPTY' });
      if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      return;
    }

    if (!event.success) {
      const errorMsg = event.error ?? 'unknown_error';
      const result = failTask(taskId, errorMsg, { step: '执行失败', output: { summary: errorMsg, error: errorMsg, unresolvedIssues: [errorMsg] } });
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

    let llmDecision: AgentEndJudgeResult | null = null;
    try {
      llmDecision = await judgeAgentEndWithLlm({
        runtime: api.runtime as PluginRuntime,
        cfg: getRuntimeConfig(api.runtime as PluginRuntime),
        agentId: agentId ?? task.executor ?? 'manager',
        task,
        transcript: text,
        output: normalizedOutput,
        modelRef: process.env.MTEAM_AGENT_END_MODEL,
        timeoutMs: Number(process.env.MTEAM_AGENT_END_TIMEOUT_MS || DEFAULT_AGENT_END_JUDGE_TIMEOUT_MS),
      });
    } catch (err) {
      api.logger?.warn?.(`[m-team] agent_end llm judge threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (llmDecision?.ok) {
      const judged = llmDecision.decision;

      if (judged.decision === 'complete') {
        const result = completeTask(taskId, {
          step,
          output: sanitizeStoredOutput({
            ...storedOutput,
            summary: stripGoalLevelLines(judged.summary) ?? storedOutput.summary,
            unresolvedIssues: judged.unresolvedIssues ?? storedOutput.unresolvedIssues,
          }),
        });
        writeTaskLog({
          taskId,
          action: 'complete',
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            decision: 'complete',
            via: 'llm',
            confidence: judged.confidence,
            reason: judged.reason,
            llm: buildLlmLogData(llmDecision),
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
          },
        });
        if (result.task) await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'next') {
        const explicitNext = parseExplicitNextStep(text);
        const llmNext = judged.nextDescription!.trim();
        const nextDescription = explicitNext
          ?? (isConciseCurrentStepDescription(llmNext) ? llmNext : buildConservativeNextDescription(task));

        if (!explicitNext && isSameCurrentStepDescription(task, nextDescription) && hasNoRealIssues(storedOutput) && !hasProblemReportSignal(text, storedOutput)) {
          const failReason = 'LLM_NEXT_REPEATS_CURRENT_STEP_WITHOUT_NEW_WORK';
          const result = failTask(taskId, failReason, {
            step: task.description,
            output: sanitizeStoredOutput({
              ...storedOutput,
              summary: stripGoalLevelLines(judged.summary ?? storedOutput.summary ?? text),
              error: failReason,
              unresolvedIssues: [failReason],
            }),
          });
          writeTaskLog({
            taskId,
            action: 'fail',
            sessionKey: sessionKey ?? undefined,
            agentId: agentId ?? undefined,
            result: {
              success: result.success,
              decision: 'fail',
              via: 'llm_repeat_guard',
              confidence: judged.confidence,
              reason: judged.reason,
              llm: buildLlmLogData(llmDecision),
              fallback: null,
              evidence: {
                summary: normalizedOutput.summary ?? '',
                files: normalizedOutput.files ?? [],
                unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
                error: normalizedOutput.error ?? null,
              },
            },
            error: failReason,
          });
          if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
          return;
        }

        const result = nextTask(taskId, agentId ?? task.executor ?? 'unknown', {
          step,
          output: sanitizeStoredOutput({
            ...storedOutput,
            summary: stripGoalLevelLines(judged.summary) ?? storedOutput.summary,
            unresolvedIssues: judged.unresolvedIssues ?? storedOutput.unresolvedIssues,
          }),
        }, nextDescription, judged.nextTaskType);
        writeTaskLog({
          taskId,
          action: 'next',
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            decision: 'next',
            via: 'llm',
            nextDescription,
            nextTaskType: judged.nextTaskType ?? null,
            confidence: judged.confidence,
            reason: judged.reason,
            llm: buildLlmLogData(llmDecision),
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
          },
        });
        if (judged.nextTaskType && judged.nextTaskType !== task.taskType) {
          api.logger?.info?.(`[m-team] agent_end taskType transition taskId=${taskId} ${task.taskType} -> ${judged.nextTaskType}`);
        }
        if (result.task) await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }

      if (judged.decision === 'fail') {
        const failReason = judged.reason || 'LLM_DECIDED_FAIL';
        const result = failTask(taskId, failReason, {
          step: task.description,
          output: sanitizeStoredOutput({
            ...storedOutput,
            summary: stripGoalLevelLines((judged.summary ?? text) || failReason),
            error: failReason,
            unresolvedIssues: judged.unresolvedIssues?.length
              ? judged.unresolvedIssues
              : (storedOutput.unresolvedIssues?.length ? storedOutput.unresolvedIssues : [failReason]),
          }),
        });
        writeTaskLog({
          taskId,
          action: 'fail',
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            decision: 'fail',
            via: 'llm',
            confidence: judged.confidence,
            reason: judged.reason,
            llm: buildLlmLogData(llmDecision),
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
          },
          error: failReason,
        });
        if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        return;
      }
    }

    const failReason = llmDecision?.ok
      ? 'LLM_DECISION_UNHANDLED'
      : (llmDecision?.error || 'LLM_DECISION_UNAVAILABLE');

    if (llmDecision && !llmDecision.ok) {
      api.logger?.warn?.(`[m-team] agent_end llm judge failed: ${llmDecision.error}${llmDecision.raw ? ` raw=${llmDecision.raw}` : ''}`);
    }

    const result = failTask(taskId, failReason, {
      step: task.description,
      output: sanitizeStoredOutput({
        ...storedOutput,
        summary: stripGoalLevelLines(text || failReason),
        error: failReason,
        unresolvedIssues: storedOutput.unresolvedIssues?.length ? storedOutput.unresolvedIssues : [failReason],
      }),
    });
    writeTaskLog({
      taskId,
      action: 'fail',
      sessionKey: sessionKey ?? undefined,
      agentId: agentId ?? undefined,
      result: {
        success: result.success,
        decision: 'fail',
        via: 'llm_fail_fast',
        reason: failReason,
        llm: buildLlmLogData(llmDecision),
        fallback: null,
        evidence: {
          summary: normalizedOutput.summary ?? '',
          files: normalizedOutput.files ?? [],
          unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
          error: normalizedOutput.error ?? null,
        },
      },
      error: failReason,
    });
    if (result.task) await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
  });
}
