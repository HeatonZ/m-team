import type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
} from 'openclaw/plugin-sdk/core';
import type { PluginHookAgentEndEvent, PluginHookAgentContext } from '../types/openclaw-hooks.js';
import type { MTeamPluginConfig } from '../config.js';
import {
  failTask,
  completeTask,
  nextTask,
} from '../pool/operations.js';
import { getTask } from '../pool/index.js';
import { judgeAgentEndWithLlm } from './agentEndLlm.js';
import { cleanAgentEndFactsWithLlm } from './agentEndFactsLlm.js';
import { writeTaskLog } from '../pool/db.js';
import {
  sendNotifications,
  getNotifications,
  formatFailNotifications,
  formatNextNotifications,
  formatTaskNotifications,
} from '../notifications.js';
import { TaskStatus, type ContextStepOutput, type Task } from '../schema/task.js';
import { TASK_CONTRACT_LIMITS } from '../task-contract.js';

const DEFAULT_AGENT_END_JUDGE_TIMEOUT_MS = 90_000;
const RETRY_AGENT_END_JUDGE_TIMEOUT_MS = 30_000;
const MAX_SAME_STEP_NEXT_WITHOUT_PROGRESS = 2;
const MAX_AUTO_REPAIR_ATTEMPTS = 3;
const AUTO_REPAIR_ISSUE_HINT_MAX_LENGTH = 48;
const STEP_MAX_LENGTH = TASK_CONTRACT_LIMITS.descriptionMaxLength;
const ECOMMERCE_SIGNAL_PATTERN = /(listing|sku|offerid|collectbox|erp|采集箱|上架|选品|跨境|电商|店铺|妙手|商品|1688|亚马逊|temu|shopee|tiktok\s*shop|aliexpress|ebay|lazada)/iu;

type AgentEndDecisionPayload = AgentEndJudgeResult extends { ok: true; decision: infer D } ? D : never;
type IssueCategory =
  | 'missing_input'
  | 'permission'
  | 'dependency'
  | 'timeout'
  | 'network'
  | 'validation'
  | 'execution'
  | 'unknown';

type AutoRepairOutcome =
  | {
    mode: 'next';
    source: 'complete_with_issues' | 'recoverable_fail';
    reason: string;
    issue: string;
    issueCategory: IssueCategory;
    previousAttempts: number;
    maxAttempts: number;
    nextDescription: string;
    nextTaskType: Task['taskType'];
  }
  | {
    mode: 'force_fail';
    source: 'complete_with_issues' | 'recoverable_fail';
    reason: string;
    issue: string;
    issueCategory: IssueCategory;
    previousAttempts: number;
    maxAttempts: number;
  };

const ISSUE_CATEGORY_PATTERNS: Array<{ category: IssueCategory; pattern: RegExp }> = [
  { category: 'permission', pattern: /(permission|forbidden|denied|unauthorized|无权限|权限不足|禁止访问|拒绝访问)/iu },
  { category: 'missing_input', pattern: /(not found|no such file|missing|ENOENT|缺少|不存在|未找到|找不到)/iu },
  { category: 'dependency', pattern: /(dependency|module|package|import|依赖|模块|包缺失)/iu },
  { category: 'timeout', pattern: /(timeout|timed out|超时)/iu },
  { category: 'network', pattern: /(network|connection|dns|socket|econn|http|https|连接失败|网络异常)/iu },
  { category: 'validation', pattern: /(validation|invalid|mismatch|assert|schema|校验失败|验证失败|不一致)/iu },
  { category: 'execution', pattern: /(error|failed|exception|crash|exit code|non-zero|失败|错误|异常|崩溃)/iu },
];

const UNRECOVERABLE_ISSUE_PATTERN = /(无可执行下一步|无法继续(?:推进)?且无(?:替代|方案)|需要人工(?:决策|审批|介入)|目标冲突无法判定|需求不明确且无法确认|no safe executable next step|manual intervention required|human decision required)/iu;

type RuntimeWithTaskStorage = PluginRuntime & {
  storage?: {
    get?: <T>(key: string) => Promise<T | null>;
  };
};

type AgentEndJudgeResult = Awaited<ReturnType<typeof judgeAgentEndWithLlm>>;
type AgentEndFactsCleanerResult = Awaited<ReturnType<typeof cleanAgentEndFactsWithLlm>>;

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
  return sessionKey.startsWith(`agent:${agentId}:m-team:${taskId}:`);
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
    .map((msg) => msg as Record<string, unknown>)
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => extractText(msg.content).trim())
    .filter(Boolean)
    .filter((text) => text !== 'NO_REPLY');
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

  if (/^[.:,;!?()[\]{}'"\s-]+$/.test(normalized)) return true;

  if (/^(none|n\/a|无|暂无|无未解决问题|无阻塞问题|no issues?|no unresolved issues?)$/iu.test(normalized)) return true;

  if (/^(unresolved issues?|issues?)[:：]?\s*(none|n\/a|无|暂无)?$/iu.test(normalized)) return true;

  if (/^(未解决问题|问题|阻塞问题)[:：]?\s*(无|暂无|none|n\/a)$/iu.test(normalized)) return true;

  if (/(等待|wait(?:ing)? for).*(agent_end|publisher|manager)/iu.test(normalized)) return true;

  if (/(当前步骤已完成|step completed|execution finished).*(等待|wait(?:ing)?)/iu.test(normalized)) return true;

  if (/^issue\b/i.test(normalized) && /\b(no|none)\b/i.test(normalized)) return true;

  return false;
}

function inferOutput(text: string): ContextStepOutput {
  const normalizedText = text.trim();

  const filePattern = /(?:\/mnt\/[^\s,;:!?，。；：)\]]+|[a-zA-Z]:\\[^\s,;:!?，。；：)\]]+|[\w./-]+\.(?:json|md|csv|txt|png|jpg|jpeg|webp|log))/g;
  const files = [...normalizedText.matchAll(filePattern)]
    .map((m) => m[0].trim());

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const issueFromHeader = lines.flatMap((line) => {
    const match = line.match(/^(?:未解决问题|阻塞问题|问题|Unresolved issues?|Issues?)\s*[:：]\s*(.+)$/iu);
    if (!match?.[1]) return [];
    return match[1]
      .split(/[、，,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  });

  const issueFromSignals = lines
    .filter((line) => /(阻塞|无法|失败|错误|异常|缺少|待补|missing|failed|error|blocked|blocker|permission)/iu.test(line))
    .map((line) => line.replace(/^[-*•+\s]+/u, '').trim());

  const issueMatches = [...issueFromHeader, ...issueFromSignals]
    .filter((item) => !isNonIssueLine(item));

  const cleanFiles = Array.from(new Set(files)).slice(0, TASK_CONTRACT_LIMITS.maxFiles);
  const cleanIssues = Array.from(new Set(issueMatches)).slice(0, TASK_CONTRACT_LIMITS.maxIssues);
  const hasNonTrivialSummary = normalizedText.length >= 12 && !/^NO_REPLY$/i.test(normalizedText);

  return {
    summary: hasNonTrivialSummary ? normalizedText.slice(0, TASK_CONTRACT_LIMITS.summaryMaxLength) : undefined,
    files: cleanFiles,
    unresolvedIssues: cleanIssues,
    error: cleanIssues.find((issue) => /(blocked|blocker|permission|failed|error|阻塞|无法|失败|错误|异常)/iu.test(issue)),
  };
}

function stripGoalLevelLines(text: string | undefined): string | undefined {
  if (!text) return undefined;

  const cleaned = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/(goal.*(reached|completed)|整体任务已完成|任务已完成|等待\s*(publisher|agent_end)|close_task|only\s+publisher|仅由\s*publisher|只有\s*publisher)/iu.test(line))
    .join('\n')
    .trim();

  return cleaned || undefined;
}

function sanitizeStoredOutput(output: ContextStepOutput): ContextStepOutput {
  const summary = stripGoalLevelLines(output.summary);

  const unresolvedIssues = Array.from(new Set(
    (output.unresolvedIssues ?? [])
      .map((issue) => stripGoalLevelLines(issue))
      .filter((issue): issue is string => Boolean(issue))
      .filter((issue) => !isNonIssueLine(issue))
      .map((issue) => normalizeIssueLine(issue))
      .filter(Boolean),
  )).slice(0, TASK_CONTRACT_LIMITS.maxIssues);

  const errorCandidate = stripGoalLevelLines(output.error);
  const error = errorCandidate && !isNonIssueLine(errorCandidate)
    ? normalizeIssueLine(errorCandidate)
    : undefined;

  return {
    ...output,
    summary,
    unresolvedIssues,
    error,
  };
}

function hasNoRealIssues(output: ContextStepOutput): boolean {
  const issues = (output.unresolvedIssues ?? []).filter((issue) => !isNonIssueLine(issue));
  return issues.length === 0 && !output.error;
}

function hasProblemReportSignal(text: string, output: ContextStepOutput): boolean {
  const combined = [text, ...(output.unresolvedIssues ?? [])].join('\n');
  return /(补齐|修复|重试|校对|检查|校验|重新生成|重新运行|补充|完善|排查|缺少|待补|阻塞|fix|retry|verify|missing|blocked|blocker)/iu.test(combined);
}

function countRecentSameStepWithoutIssues(task: Task, step: string): number {
  const normalizedStep = sanitizeStepInstruction(step);
  if (!normalizedStep) return 0;

  const stepEntries = task.context.filter((entry): entry is Task['context'][number] & { type: 'step' } => entry.type === 'step');
  let count = 0;

  for (let i = stepEntries.length - 1; i >= 0; i--) {
    const entry = stepEntries[i];
    const entryStep = sanitizeStepInstruction(entry.step);
    if (!entryStep || entryStep !== normalizedStep) break;
    if (!hasNoRealIssues(entry.output ?? {})) break;
    count++;
  }

  return count;
}

function sanitizeStepInstruction(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^问题[:：]\s*/u, '').trim();
  text = text.replace(/^next step[:：]?\s*/iu, '').trim();
  text = text.replace(/[。；;]\s*继续如实汇报.*$/u, '').trim();
  text = text.replace(/^[-—–•+\s]+/u, '').trim();
  return text.length > STEP_MAX_LENGTH ? text.slice(0, STEP_MAX_LENGTH) : text;
}

function hasEcommerceSignal(text: string | undefined): boolean {
  if (!text) return false;
  return ECOMMERCE_SIGNAL_PATTERN.test(text);
}

function resolveNextTaskTypeWithDomainGuard(params: {
  task: Task;
  requestedNextTaskType: Task['taskType'] | undefined;
  nextDescription: string;
  transcript: string;
  cleanedOutput: ContextStepOutput;
}): {
  taskType: Task['taskType'];
  normalizedBy: 'none' | 'ecommerce_guard';
} {
  const requested = params.requestedNextTaskType ?? params.task.taskType;
  if (params.task.taskType !== 'ecommerce') {
    return { taskType: requested, normalizedBy: 'none' };
  }

  // Guardrail: ecommerce listing/copy baton should stay ecommerce even if LLM returns content.
  // This keeps claim routing stable for cross-border operations workflows.
  const hasDomainSignal = [
    params.task.goal,
    params.task.description,
    params.nextDescription,
    params.cleanedOutput.summary,
    params.transcript,
  ].some(hasEcommerceSignal);

  if (requested === 'content' && hasDomainSignal) {
    return { taskType: 'ecommerce', normalizedBy: 'ecommerce_guard' };
  }

  return { taskType: requested, normalizedBy: 'none' };
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
    if (!match?.[1]) continue;

    const next = match[1].trim().replace(/^[-—–•+\s]+/u, '');
    if (next && !/^(无未解决问题|none)$/iu.test(next)) return next;
  }

  return null;
}

function isConciseCurrentStepDescription(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.length > STEP_MAX_LENGTH) return false;
  if (/(当前任务|本轮报告|问题[:：]|结果摘要|产出文件|未解决问题|agent_end)/iu.test(normalized)) return false;
  return true;
}

function pickPrimaryIssue(output: ContextStepOutput, judgedIssues?: string[]): string | null {
  const candidates = [
    output.error,
    ...(output.unresolvedIssues ?? []),
    ...(judgedIssues ?? []),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeIssueLine(candidate);
    if (!normalized || isNonIssueLine(normalized)) continue;
    return normalized;
  }

  return null;
}

function categorizeIssue(issue: string): IssueCategory {
  for (const item of ISSUE_CATEGORY_PATTERNS) {
    if (item.pattern.test(issue)) return item.category;
  }
  return 'unknown';
}

function countRecentIssueAttempts(task: Task, category: IssueCategory): number {
  const stepEntries = task.context.filter((entry): entry is Task['context'][number] & { type: 'step' } => entry.type === 'step');
  if (stepEntries.length === 0) return 0;

  let count = 0;
  for (let i = stepEntries.length - 1; i >= 0; i--) {
    const issue = pickPrimaryIssue(stepEntries[i].output ?? {});
    if (!issue) break;
    if (categorizeIssue(issue) !== category) break;
    count++;
  }

  return count;
}

function buildAutoRepairNextDescription(task: Task, issue: string): string {
  const issueHint = issue.slice(0, AUTO_REPAIR_ISSUE_HINT_MAX_LENGTH).trim();
  const currentStep = sanitizeStepInstruction(task.description) || task.description.trim();
  const candidate = `修复当前步骤问题：${issueHint}；完成后重跑“${currentStep}”并报告修复动作、验证结果、产物路径。`;
  return sanitizeStepInstruction(candidate) || buildConservativeNextDescription(task);
}

function resolveAutoRepairOutcome(task: Task, output: ContextStepOutput, judged: AgentEndDecisionPayload): AutoRepairOutcome | null {
  if (judged.decision !== 'complete' && judged.decision !== 'fail') return null;

  const issue = pickPrimaryIssue(output, judged.unresolvedIssues);
  if (!issue) return null;

  const source = judged.decision === 'complete' ? 'complete_with_issues' : 'recoverable_fail';
  if (source === 'recoverable_fail' && UNRECOVERABLE_ISSUE_PATTERN.test(`${issue}\n${judged.reason}`)) {
    return null;
  }

  const issueCategory = categorizeIssue(issue);
  const previousAttempts = countRecentIssueAttempts(task, issueCategory);

  if (previousAttempts + 1 >= MAX_AUTO_REPAIR_ATTEMPTS) {
    return {
      mode: 'force_fail',
      source,
      issue,
      issueCategory,
      previousAttempts,
      maxAttempts: MAX_AUTO_REPAIR_ATTEMPTS,
      reason: `AUTO_REPAIR_BUDGET_EXCEEDED_${issueCategory.toUpperCase()}`,
    };
  }

  const nextTaskType = judged.nextTaskType ?? task.taskType;
  return {
    mode: 'next',
    source,
    issue,
    issueCategory,
    previousAttempts,
    maxAttempts: MAX_AUTO_REPAIR_ATTEMPTS,
    nextTaskType,
    nextDescription: buildAutoRepairNextDescription(task, issue),
    reason: source === 'complete_with_issues'
      ? 'AUTO_REPAIR_FROM_COMPLETE_WITH_ISSUES'
      : 'AUTO_REPAIR_FROM_RECOVERABLE_FAIL',
  };
}

function withJudgedSummary(base: ContextStepOutput, summary: string | undefined): ContextStepOutput {
  const nextSummary = stripGoalLevelLines(summary) ?? base.summary;
  return sanitizeStoredOutput({
    ...base,
    ...(nextSummary ? { summary: nextSummary } : {}),
  });
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

function buildFactsCleanerLogData(factsCleaner: AgentEndFactsCleanerResult | null): Record<string, unknown> | null {
  if (!factsCleaner) return null;

  if (!factsCleaner.ok) {
    return {
      source: 'llm',
      status: 'error',
      error: factsCleaner.error,
      raw: factsCleaner.raw ?? null,
    };
  }

  return {
    source: 'llm',
    status: 'ok',
    raw: factsCleaner.raw ?? null,
    parsed: {
      summary: factsCleaner.facts.summary ?? null,
      files: factsCleaner.facts.files ?? [],
      unresolvedIssues: factsCleaner.facts.unresolvedIssues ?? [],
      error: factsCleaner.facts.error ?? null,
    },
  };
}

function buildAutoRepairLogData(outcome: AutoRepairOutcome | null): Record<string, unknown> | null {
  if (!outcome) return null;

  const base = {
    mode: outcome.mode,
    source: outcome.source,
    reason: outcome.reason,
    issue: outcome.issue,
    issueCategory: outcome.issueCategory,
    previousAttempts: outcome.previousAttempts,
    maxAttempts: outcome.maxAttempts,
  };

  if (outcome.mode === 'next') {
    return {
      ...base,
      nextDescription: outcome.nextDescription,
      nextTaskType: outcome.nextTaskType,
    };
  }

  return base;
}

function shouldRetryAgentEndJudge(error: string | undefined): boolean {
  if (!error) return false;
  return [
    'LLM_DECISION_TIMEOUT',
    'LLM_DECISION_EMPTY_OUTPUT',
    'LLM_DECISION_TRUNCATED_EMPTY',
    'LLM_DECISION_EMPTY_OUTPUT_LENGTH_LIMIT',
    'LLM_DECISION_PROVIDER_ERROR',
  ].includes(error);
}

function shouldRetryAgentEndFactsClean(error: string | undefined): boolean {
  if (!error) return false;
  return [
    'LLM_FACTS_CLEAN_TIMEOUT',
    'LLM_FACTS_CLEAN_EMPTY_OUTPUT',
    'LLM_FACTS_CLEAN_TRUNCATED_EMPTY',
    'LLM_FACTS_CLEAN_EMPTY_OUTPUT_LENGTH_LIMIT',
    'LLM_FACTS_CLEAN_PROVIDER_ERROR',
  ].includes(error);
}

function resolveJudgeTimeoutMs(config?: MTeamPluginConfig): number {
  const envTimeout = Number(process.env.MTEAM_AGENT_END_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
  if (typeof config?.agentEndJudgeTimeoutMs === 'number' && config.agentEndJudgeTimeoutMs > 0) {
    return config.agentEndJudgeTimeoutMs;
  }
  return DEFAULT_AGENT_END_JUDGE_TIMEOUT_MS;
}

function resolveFactsCleanerModelRef(config?: MTeamPluginConfig): string | undefined {
  if (process.env.MTEAM_AGENT_END_FACTS_MODEL?.trim()) {
    return process.env.MTEAM_AGENT_END_FACTS_MODEL.trim();
  }
  if (process.env.MTEAM_AGENT_END_MODEL?.trim()) {
    return process.env.MTEAM_AGENT_END_MODEL.trim();
  }
  if (config?.agentEndFactsModel?.trim()) {
    return config.agentEndFactsModel.trim();
  }
  return config?.agentEndJudgeModel?.trim() || undefined;
}

function resolveJudgeModelRef(config?: MTeamPluginConfig): string | undefined {
  if (process.env.MTEAM_AGENT_END_MODEL?.trim()) {
    return process.env.MTEAM_AGENT_END_MODEL.trim();
  }
  return config?.agentEndJudgeModel?.trim() || undefined;
}

export function registerAgentEndHook(api: OpenClawPluginApi, config?: MTeamPluginConfig): void {
  const logAgentEndSkip = (
    reason: string,
    meta: {
      sessionKey?: string;
      agentId?: string;
      taskId?: string | null;
      taskStatus?: string;
      messageCount?: number;
      success?: boolean;
    },
  ): void => {
    api.logger?.info?.(
      `[m-team] agent_end skip reason=${reason} taskId=${meta.taskId ?? 'unknown'} status=${meta.taskStatus ?? 'n/a'} sessionKey=${meta.sessionKey ?? 'missing-session-key'} agentId=${meta.agentId ?? 'missing-agent-id'} success=${String(meta.success)} messageCount=${meta.messageCount ?? 0}`,
    );
  };

  api.on('agent_end', async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
    const { sessionKey, agentId } = ctx;
    const rawMessageCount = event.messages?.length ?? 0;

    const taskId = parseTaskId(sessionKey ?? '');
    if (!taskId) {
      return;
    }
    
    api.logger?.info?.(
      `[m-team] agent_end received sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'} success=${event.success} messageCount=${rawMessageCount}`,
    );

    if (!isExecutorSessionForTask(sessionKey, agentId, taskId)) {
      logAgentEndSkip('SESSION_NOT_EXECUTOR_TASK', {
        sessionKey,
        agentId,
        taskId,
        success: event.success,
        messageCount: rawMessageCount,
      });
      return;
    }

    const runtime = api.runtime as RuntimeWithTaskStorage;
    const task = await runtime.storage?.get?.<Task>(`mteam:task:${taskId}`).catch(() => null)
      ?? getTask(taskId)
      ?? null;

    if (!task) {
      api.logger?.warn?.(`[m-team] agent_end task lookup miss taskId=${taskId} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      logAgentEndSkip('TASK_LOOKUP_MISS', {
        sessionKey,
        agentId,
        taskId,
        success: event.success,
        messageCount: rawMessageCount,
      });
      return;
    }

    if (task.status !== TaskStatus.RUNNING) {
      logAgentEndSkip('TASK_NOT_RUNNING', {
        sessionKey,
        agentId,
        taskId,
        taskStatus: task.status,
        success: event.success,
        messageCount: rawMessageCount,
      });
      return;
    }

    const nonSystemMessages = (event.messages ?? []).filter((msg: unknown) => (msg as Record<string, unknown>).role !== 'system');
    if (nonSystemMessages.length === 0) {
      api.logger?.warn?.(`[m-team] agent_end fail reason=AGENT_END_MESSAGES_EMPTY taskId=${taskId} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      const result = failTask(taskId, 'AGENT_END_MESSAGES_EMPTY', {
        step: task.description,
        output: {
          summary: 'AGENT_END_MESSAGES_EMPTY',
          error: 'AGENT_END_MESSAGES_EMPTY',
          unresolvedIssues: ['AGENT_END_MESSAGES_EMPTY'],
        },
      });

      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: { success: result.success, decision: 'fail' },
        error: 'AGENT_END_MESSAGES_EMPTY',
      });

      if (result.task) {
        await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      }
      return;
    }

    if (!event.success) {
      const errorMsg = event.error ?? 'unknown_error';
      api.logger?.warn?.(`[m-team] agent_end fail reason=${errorMsg} taskId=${taskId} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      const result = failTask(taskId, errorMsg, {
        step: 'Execution failed',
        output: {
          summary: errorMsg,
          error: errorMsg,
          unresolvedIssues: [errorMsg],
        },
      });

      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: { success: result.success, decision: 'fail' },
        error: errorMsg,
      });

      if (result.task) {
        await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      }
      return;
    }

    const text = lastAssistantText(nonSystemMessages);
    const inferredOutput = inferOutput(text);
    const normalizedOutput: ContextStepOutput = {
      summary: inferredOutput.summary,
      files: inferredOutput.files ?? [],
      unresolvedIssues: inferredOutput.unresolvedIssues ?? [],
      error: inferredOutput.error,
    };

    let factsCleaner: AgentEndFactsCleanerResult | null = null;
    let factsCleanerAttempts = 0;
    const judgeTimeoutMs = resolveJudgeTimeoutMs(config);
    const factsCleanerModelRef = resolveFactsCleanerModelRef(config);
    const judgeModelRef = resolveJudgeModelRef(config);
    try {
      factsCleanerAttempts = 1;
      factsCleaner = await cleanAgentEndFactsWithLlm({
        runtime: api.runtime as PluginRuntime,
        cfg: getRuntimeConfig(api.runtime as PluginRuntime),
        agentId: agentId ?? task.executor ?? 'manager',
        task,
        transcript: text,
        output: normalizedOutput,
        modelRef: factsCleanerModelRef,
        timeoutMs: judgeTimeoutMs,
      });

      if (!factsCleaner.ok && shouldRetryAgentEndFactsClean(factsCleaner.error)) {
        factsCleanerAttempts = 2;
        api.logger?.warn?.(`[m-team] agent_end facts cleaner transient failure, retry once: ${factsCleaner.error}`);
        factsCleaner = await cleanAgentEndFactsWithLlm({
          runtime: api.runtime as PluginRuntime,
          cfg: getRuntimeConfig(api.runtime as PluginRuntime),
          agentId: agentId ?? task.executor ?? 'manager',
          task,
          transcript: text,
          output: normalizedOutput,
          modelRef: factsCleanerModelRef,
          timeoutMs: Math.min(judgeTimeoutMs, RETRY_AGENT_END_JUDGE_TIMEOUT_MS),
        });
      }
    } catch (err) {
      api.logger?.warn?.(`[m-team] agent_end facts cleaner threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!factsCleaner?.ok) {
      const failReason = factsCleaner?.error || 'LLM_FACTS_CLEAN_UNAVAILABLE';
      const fallbackOutput = sanitizeStoredOutput(normalizedOutput);
      api.logger?.warn?.(`[m-team] agent_end facts cleaner failed taskId=${taskId} reason=${failReason} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);

      const result = failTask(taskId, failReason, {
        step: task.description,
        output: {
          ...fallbackOutput,
          error: failReason,
          unresolvedIssues: fallbackOutput.unresolvedIssues?.length ? fallbackOutput.unresolvedIssues : [failReason],
        },
      });

      writeTaskLog({
        taskId,
        action: 'fail',
        sessionKey: sessionKey ?? undefined,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          decision: 'fail',
          via: 'llm_facts_clean_fail_fast',
          reason: failReason,
          cleaner: {
            ...buildFactsCleanerLogData(factsCleaner),
            attempts: factsCleanerAttempts,
          },
          llm: null,
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

      if (result.task) {
        await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
      }
      return;
    }

    const cleanedOutput = sanitizeStoredOutput(factsCleaner.facts);

    let llmDecision: AgentEndJudgeResult | null = null;
    let llmJudgeAttempts = 0;
    try {
      llmJudgeAttempts = 1;
      llmDecision = await judgeAgentEndWithLlm({
        runtime: api.runtime as PluginRuntime,
        cfg: getRuntimeConfig(api.runtime as PluginRuntime),
        agentId: agentId ?? task.executor ?? 'manager',
        task,
        transcript: text,
        output: cleanedOutput,
        modelRef: judgeModelRef,
        timeoutMs: judgeTimeoutMs,
      });
      if (!llmDecision.ok && shouldRetryAgentEndJudge(llmDecision.error)) {
        llmJudgeAttempts = 2;
        api.logger?.warn?.(`[m-team] agent_end llm transient failure, retry once: ${llmDecision.error}`);
        llmDecision = await judgeAgentEndWithLlm({
          runtime: api.runtime as PluginRuntime,
          cfg: getRuntimeConfig(api.runtime as PluginRuntime),
          agentId: agentId ?? task.executor ?? 'manager',
          task,
          transcript: text,
          output: cleanedOutput,
          modelRef: judgeModelRef,
          timeoutMs: Math.min(judgeTimeoutMs, RETRY_AGENT_END_JUDGE_TIMEOUT_MS),
        });
      }
    } catch (err) {
      api.logger?.warn?.(`[m-team] agent_end llm judge threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (llmDecision?.ok) {
      const judged = llmDecision.decision;
      api.logger?.info?.(`[m-team] agent_end llm decision taskId=${taskId} decision=${judged.decision} confidence=${judged.confidence} nextTaskType=${judged.nextTaskType ?? 'none'} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);
      const autoRepairOutcome = resolveAutoRepairOutcome(task, cleanedOutput, judged);

      if (autoRepairOutcome?.mode === 'next') {
        api.logger?.info?.(
          `[m-team] agent_end auto_repair next taskId=${taskId} source=${autoRepairOutcome.source} issueCategory=${autoRepairOutcome.issueCategory} attempt=${autoRepairOutcome.previousAttempts + 1}/${autoRepairOutcome.maxAttempts}`,
        );

        const resolvedNextTaskType = resolveNextTaskTypeWithDomainGuard({
          task,
          requestedNextTaskType: autoRepairOutcome.nextTaskType,
          nextDescription: autoRepairOutcome.nextDescription,
          transcript: text,
          cleanedOutput,
        });

        const result = nextTask(
          taskId,
          agentId ?? task.executor ?? 'unknown',
          {
            step: task.description,
            output: withJudgedSummary(cleanedOutput, judged.summary),
          },
          autoRepairOutcome.nextDescription,
          resolvedNextTaskType.taskType,
        );

        writeTaskLog({
          taskId,
          action: 'next',
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            decision: 'next',
            via: 'llm_auto_repair',
            nextDescription: autoRepairOutcome.nextDescription,
            nextTaskType: resolvedNextTaskType.taskType,
            requestedNextTaskType: autoRepairOutcome.nextTaskType,
            taskTypeNormalizedBy: resolvedNextTaskType.normalizedBy,
            confidence: judged.confidence,
            reason: judged.reason,
            cleaner: {
              ...buildFactsCleanerLogData(factsCleaner),
              attempts: factsCleanerAttempts,
            },
            llm: {
              ...buildLlmLogData(llmDecision),
              attempts: llmJudgeAttempts,
            },
            autoRepair: buildAutoRepairLogData(autoRepairOutcome),
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
            cleanedFacts: {
              summary: cleanedOutput.summary ?? '',
              files: cleanedOutput.files ?? [],
              unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
              error: cleanedOutput.error ?? null,
            },
          },
        });

        if (resolvedNextTaskType.normalizedBy !== 'none') {
          api.logger?.info?.(
            `[m-team] agent_end taskType normalized taskId=${taskId} from=${autoRepairOutcome.nextTaskType} to=${resolvedNextTaskType.taskType} by=${resolvedNextTaskType.normalizedBy}`,
          );
        }
        if (resolvedNextTaskType.taskType !== task.taskType) {
          api.logger?.info?.(`[m-team] agent_end taskType transition taskId=${taskId} ${task.taskType} -> ${resolvedNextTaskType.taskType}`);
        }

        if (result.task) {
          await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        }
        return;
      }

      if (autoRepairOutcome?.mode === 'force_fail') {
        const failReason = autoRepairOutcome.reason;
        const unresolvedIssues = [
          autoRepairOutcome.issue,
          failReason,
        ].filter(Boolean);

        api.logger?.warn?.(
          `[m-team] agent_end auto_repair budget exceeded taskId=${taskId} issueCategory=${autoRepairOutcome.issueCategory} attempts=${autoRepairOutcome.previousAttempts + 1}/${autoRepairOutcome.maxAttempts}`,
        );

        const result = failTask(taskId, failReason, {
          step: task.description,
          output: withJudgedSummary({
            ...cleanedOutput,
            summary: cleanedOutput.summary ?? stripGoalLevelLines(text) ?? failReason,
            error: failReason,
            unresolvedIssues: unresolvedIssues.length ? unresolvedIssues : [failReason],
          }, judged.summary),
        });

        writeTaskLog({
          taskId,
          action: 'fail',
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            decision: 'fail',
            via: 'llm_auto_repair_budget',
            confidence: judged.confidence,
            reason: judged.reason,
            cleaner: {
              ...buildFactsCleanerLogData(factsCleaner),
              attempts: factsCleanerAttempts,
            },
            llm: {
              ...buildLlmLogData(llmDecision),
              attempts: llmJudgeAttempts,
            },
            autoRepair: buildAutoRepairLogData(autoRepairOutcome),
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
            cleanedFacts: {
              summary: cleanedOutput.summary ?? '',
              files: cleanedOutput.files ?? [],
              unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
              error: cleanedOutput.error ?? null,
            },
          },
          error: failReason,
        });

        if (result.task) {
          await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        }
        return;
      }

      if (judged.decision === 'complete') {
        const result = completeTask(taskId, {
          step: task.description,
          output: withJudgedSummary(cleanedOutput, judged.summary),
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
            cleaner: {
              ...buildFactsCleanerLogData(factsCleaner),
              attempts: factsCleanerAttempts,
            },
            llm: {
              ...buildLlmLogData(llmDecision),
              attempts: llmJudgeAttempts,
            },
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
            cleanedFacts: {
              summary: cleanedOutput.summary ?? '',
              files: cleanedOutput.files ?? [],
              unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
              error: cleanedOutput.error ?? null,
            },
          },
        });

        if (result.task) {
          await sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        }
        return;
      }

      if (judged.decision === 'next') {
        const explicitNext = parseExplicitNextStep(text);
        const llmNext = judged.nextDescription!.trim();
        const nextDescription = explicitNext
          ?? (isConciseCurrentStepDescription(llmNext) ? llmNext : buildConservativeNextDescription(task));
        const resolvedNextTaskType = resolveNextTaskTypeWithDomainGuard({
          task,
          requestedNextTaskType: judged.nextTaskType,
          nextDescription,
          transcript: text,
          cleanedOutput,
        });

        if (!explicitNext && isSameCurrentStepDescription(task, nextDescription) && hasNoRealIssues(cleanedOutput) && !hasProblemReportSignal(text, cleanedOutput)) {
          const sameStepRepeatCount = countRecentSameStepWithoutIssues(task, task.description) + 1;
          if (sameStepRepeatCount >= MAX_SAME_STEP_NEXT_WITHOUT_PROGRESS) {
            const failReason = 'LLM_NEXT_REPEATS_CURRENT_STEP_WITHOUT_NEW_WORK';
            const result = failTask(taskId, failReason, {
              step: task.description,
              output: {
                ...cleanedOutput,
                error: failReason,
                unresolvedIssues: [failReason],
              },
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
                cleaner: {
                  ...buildFactsCleanerLogData(factsCleaner),
                  attempts: factsCleanerAttempts,
                },
                llm: {
                  ...buildLlmLogData(llmDecision),
                  attempts: llmJudgeAttempts,
                },
                repeatCount: sameStepRepeatCount,
                repeatLimit: MAX_SAME_STEP_NEXT_WITHOUT_PROGRESS,
                fallback: null,
                evidence: {
                  summary: normalizedOutput.summary ?? '',
                  files: normalizedOutput.files ?? [],
                  unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
                  error: normalizedOutput.error ?? null,
                },
                cleanedFacts: {
                  summary: cleanedOutput.summary ?? '',
                  files: cleanedOutput.files ?? [],
                  unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
                  error: cleanedOutput.error ?? null,
                },
              },
              error: failReason,
            });

            if (result.task) {
              await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
            }
            return;
          }

          api.logger?.warn?.(`[m-team] agent_end repeat-guard soft pass taskId=${taskId} repeatCount=${sameStepRepeatCount}/${MAX_SAME_STEP_NEXT_WITHOUT_PROGRESS}`);
        }

        const result = nextTask(
          taskId,
          agentId ?? task.executor ?? 'unknown',
            {
              step: task.description,
              output: withJudgedSummary(cleanedOutput, judged.summary),
            },
            nextDescription,
            resolvedNextTaskType.taskType,
          );

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
            nextTaskType: resolvedNextTaskType.taskType,
            requestedNextTaskType: judged.nextTaskType ?? null,
            taskTypeNormalizedBy: resolvedNextTaskType.normalizedBy,
            confidence: judged.confidence,
            reason: judged.reason,
            cleaner: {
              ...buildFactsCleanerLogData(factsCleaner),
              attempts: factsCleanerAttempts,
            },
            llm: {
              ...buildLlmLogData(llmDecision),
              attempts: llmJudgeAttempts,
            },
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
            cleanedFacts: {
              summary: cleanedOutput.summary ?? '',
              files: cleanedOutput.files ?? [],
              unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
              error: cleanedOutput.error ?? null,
            },
          },
        });

        if (resolvedNextTaskType.normalizedBy !== 'none') {
          api.logger?.info?.(
            `[m-team] agent_end taskType normalized taskId=${taskId} from=${judged.nextTaskType ?? task.taskType} to=${resolvedNextTaskType.taskType} by=${resolvedNextTaskType.normalizedBy}`,
          );
        }
        if (resolvedNextTaskType.taskType !== task.taskType) {
          api.logger?.info?.(`[m-team] agent_end taskType transition taskId=${taskId} ${task.taskType} -> ${resolvedNextTaskType.taskType}`);
        }

        if (result.task) {
          await sendNotifications(formatNextNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        }
        return;
      }

      if (judged.decision === 'fail') {
        const failReason = judged.reason || 'LLM_DECIDED_FAIL';
        const result = failTask(taskId, failReason, {
          step: task.description,
          output: withJudgedSummary({
            ...cleanedOutput,
            summary: cleanedOutput.summary ?? stripGoalLevelLines(text) ?? failReason,
            error: failReason,
            unresolvedIssues: cleanedOutput.unresolvedIssues?.length
              ? cleanedOutput.unresolvedIssues
              : [failReason],
          }, judged.summary),
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
            cleaner: {
              ...buildFactsCleanerLogData(factsCleaner),
              attempts: factsCleanerAttempts,
            },
            llm: {
              ...buildLlmLogData(llmDecision),
              attempts: llmJudgeAttempts,
            },
            fallback: null,
            evidence: {
              summary: normalizedOutput.summary ?? '',
              files: normalizedOutput.files ?? [],
              unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
              error: normalizedOutput.error ?? null,
            },
            cleanedFacts: {
              summary: cleanedOutput.summary ?? '',
              files: cleanedOutput.files ?? [],
              unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
              error: cleanedOutput.error ?? null,
            },
          },
          error: failReason,
        });

        if (result.task) {
          await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
        }
        return;
      }
    }

    const failReason = llmDecision?.ok
      ? 'LLM_DECISION_UNHANDLED'
      : (llmDecision?.error || 'LLM_DECISION_UNAVAILABLE');

    if (llmDecision && !llmDecision.ok) {
      api.logger?.warn?.(`[m-team] agent_end llm judge failed: ${llmDecision.error}${llmDecision.raw ? ` raw=${llmDecision.raw}` : ''}`);
    }

    api.logger?.warn?.(`[m-team] agent_end fail-fast taskId=${taskId} reason=${failReason} sessionKey=${sessionKey ?? 'missing-session-key'} agentId=${agentId ?? 'missing-agent-id'}`);

    const result = failTask(taskId, failReason, {
      step: task.description,
      output: {
        ...cleanedOutput,
        summary: cleanedOutput.summary ?? stripGoalLevelLines(text) ?? failReason,
        error: failReason,
        unresolvedIssues: cleanedOutput.unresolvedIssues?.length ? cleanedOutput.unresolvedIssues : [failReason],
      },
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
        cleaner: {
          ...buildFactsCleanerLogData(factsCleaner),
          attempts: factsCleanerAttempts,
        },
        llm: {
          ...buildLlmLogData(llmDecision),
          attempts: llmJudgeAttempts,
        },
        fallback: null,
        evidence: {
          summary: normalizedOutput.summary ?? '',
          files: normalizedOutput.files ?? [],
          unresolvedIssues: normalizedOutput.unresolvedIssues ?? [],
          error: normalizedOutput.error ?? null,
        },
        cleanedFacts: {
          summary: cleanedOutput.summary ?? '',
          files: cleanedOutput.files ?? [],
          unresolvedIssues: cleanedOutput.unresolvedIssues ?? [],
          error: cleanedOutput.error ?? null,
        },
      },
      error: failReason,
    });

    if (result.task) {
      await sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null).catch(() => null);
    }
  });
}
