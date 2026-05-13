import type { OpenClawConfig, PluginRuntime } from 'openclaw/plugin-sdk/core';
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
  extractAssistantVisibleText,
  extractAssistantText,
} from 'openclaw/plugin-sdk/agent-runtime';
import type { Context as PiContext } from '@mariozechner/pi-ai';
import { VALID_TASK_TYPES, type Task, type ContextStepOutput, type TaskType } from '../schema/task.js';
import { buildTaskDescriptionQualityRules, buildTaskTypeGuidanceBlock } from '../task-type.js';
import {
  buildAgentEndDecisionContractBlock,
  buildContextOutputQualityRules,
  buildGoalQualityRules,
  TASK_CONTRACT_LIMITS,
} from '../task-contract.js';

export type AgentEndDecision = {
  decision: 'complete' | 'next' | 'fail';
  reason: string;
  nextDescription?: string;
  nextTaskType?: Task['taskType'];
  summary?: string;
  unresolvedIssues?: string[];
  confidence?: 'low' | 'medium' | 'high';
};

type AssistantMessageLike = {
  stopReason?: string;
  errorMessage?: string;
  usage?: { output?: number };
  content?: unknown;
};

const AGENT_END_LLM_MAX_TOKENS = 1200;

function normalizeDecisionTaskType(raw: unknown): TaskType | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  return VALID_TASK_TYPES.includes(value as TaskType) ? (value as TaskType) : undefined;
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (record.type !== 'text') return '';
      return typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractDecisionRaw(message: AssistantMessageLike): string {
  const visibleText = extractAssistantVisibleText(message as never)?.trim() ?? '';
  if (visibleText) return visibleText;
  const plainText = extractAssistantText(message as never)?.trim() ?? '';
  if (plainText) return plainText;
  return extractTextBlocks(message.content);
}

function extractLatestJsonObject(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') starts.push(i);
  }
  if (starts.length === 0) return null;

  for (let s = starts.length - 1; s >= 0; s--) {
    const start = starts[s];
    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }
        if (ch === '\\') {
          escaping = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1).trim();
        }
      }
    }
  }

  return null;
}

function buildDecisionPrompt(params: {
  task: Task;
  transcript: string;
  output: ContextStepOutput;
}): string {
  const { task, transcript, output } = params;
  const taskTypeGuidance = buildTaskTypeGuidanceBlock();
  const descriptionRules = buildTaskDescriptionQualityRules();
  const goalRules = buildGoalQualityRules();
  const contextOutputRules = buildContextOutputQualityRules();
  const decisionContractRules = buildAgentEndDecisionContractBlock();
  const contextLines = task.context
    .filter((entry) => entry.type === 'step')
    .slice(-TASK_CONTRACT_LIMITS.agentEndRecentContextLimit)
    .map((entry, index) => {
      const files = entry.output?.files?.length ? ` | files=${entry.output.files.join(', ')}` : '';
      const issues = entry.output?.unresolvedIssues?.length ? ` | issues=${entry.output.unresolvedIssues.join(' ; ')}` : '';
      return `${index + 1}. step=${entry.step}\n   summary=${entry.output?.summary ?? ''}${files}${issues}`;
    })
    .join('\n');

  return [
    'You are the m-team agent_end adjudicator.',
    'Decide task state from goal, current step, recent context, and executor transcript.',
    'Do not trust completion claims without evidence.',
    '',
    '[Language rule]',
    '- Keep JSON keys in English.',
    '- Write natural-language values in Chinese.',
    '- reason, summary, unresolvedIssues, nextDescription should be Chinese.',
    '- Do not translate code, JSON keys, API fields, or file paths.',
    '',
    'Allowed decisions: complete | next | fail',
    'Rules:',
    '1. complete only when step done + goal achieved + no unresolved issues + no next action.',
    '2. next when there is progress but goal not done, or a clear next action exists.',
    '2.1 For next, nextDescription is required, one-step, concise, actionable.',
    '2.2 nextTaskType is optional when routing should change (general/coding/research/ops/data/design/content/ecommerce).',
    '3. fail only when blocked or no safe executable next step.',
    '4. Avoid drift; judge against current description.',
    '5. Executor reports facts; agent_end decides next action.',
    '6. nextDescription must contain only next current step.',
    '7. If transcript lacks evidence, do not return complete.',
    '8. Keep JSON concise:',
    '8.1 reason <= 120 Chinese characters.',
    `8.2 nextDescription <= ${TASK_CONTRACT_LIMITS.agentEndNextDescriptionMaxLength} Chinese characters.`,
    `8.3 unresolvedIssues up to ${TASK_CONTRACT_LIMITS.agentEndMaxUnresolvedIssues} items.`,
    '',
    taskTypeGuidance,
    '',
    descriptionRules,
    '',
    goalRules,
    '',
    contextOutputRules,
    '',
    decisionContractRules,
    '',
    'Return JSON only. No markdown. No code fences.',
    'JSON schema:',
    '{',
    '  "decision": "complete|next|fail",',
    '  "reason": "string in Chinese",',
    '  "nextDescription": "string in Chinese (required when decision=next)",',
    '  "nextTaskType": "general|coding|research|ops|data|design|content|ecommerce" (optional),',
    '  "summary": "string in Chinese (optional)",',
    '  "unresolvedIssues": ["string in Chinese", ...] (optional),',
    '  "confidence": "low|medium|high"',
    '}',
    '',
    `goal: ${task.goal}`,
    `current_description: ${task.description}`,
    `current_output_summary: ${output.summary ?? ''}`,
    `current_output_files: ${(output.files ?? []).join(', ')}`,
    `current_unresolved_issues: ${(output.unresolvedIssues ?? []).join(' ; ')}`,
    '',
    'recent_context:',
    contextLines || '(empty)',
    '',
    'current_transcript:',
    transcript || '(empty)',
  ].join('\n');
}

function extractQuotedField(raw: string, field: string): string | undefined {
  const patterns = [
    new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'),
    new RegExp(`${field}\\s*[:=]\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;

    try {
      return JSON.parse(`"${match[1]}"`).trim();
    } catch {
      return match[1].replace(/\\"/g, '"').trim();
    }
  }

  return undefined;
}

function extractArrayField(raw: string, field: string): string[] | undefined {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'i'));
  if (!match?.[1]) return undefined;

  const values = [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((item) => {
      try {
        return JSON.parse(`"${item[1]}"`).trim();
      } catch {
        return item[1].replace(/\\"/g, '"').trim();
      }
    })
    .filter(Boolean)
    .slice(0, 10);

  return values.length ? values : undefined;
}

function parseDecisionLoose(raw: string): AgentEndDecision | null {
  const decisionMatch = raw.match(/"decision"\s*:\s*"(complete|next|fail)"/i)
    ?? raw.match(/\bdecision\b\s*[:=]\s*(complete|next|fail)/i);
  const decision = decisionMatch?.[1]?.toLowerCase() as AgentEndDecision['decision'] | undefined;
  if (!decision) return null;

  const reason = extractQuotedField(raw, 'reason') ?? 'LLM returned a partial decision payload';
  const nextDescription = decision === 'next'
    ? extractQuotedField(raw, 'nextDescription')
    : undefined;
  if (decision === 'next' && !nextDescription) return null;

  const nextTaskType = decision === 'next'
    ? normalizeDecisionTaskType(extractQuotedField(raw, 'nextTaskType'))
    : undefined;

  const confidence = extractQuotedField(raw, 'confidence');
  const summary = extractQuotedField(raw, 'summary');
  const unresolvedIssues = extractArrayField(raw, 'unresolvedIssues');

  return {
    decision,
    reason,
    nextDescription,
    nextTaskType,
    summary,
    unresolvedIssues,
    confidence: confidence === 'low' || confidence === 'medium' || confidence === 'high' ? confidence : undefined,
  };
}

function parseDecision(raw: string): AgentEndDecision | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];

  const latestJson = extractLatestJsonObject(trimmed);
  if (latestJson) candidates.unshift(latestJson);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const objectSlice = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (objectSlice) candidates.push(objectSlice);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const decision = parsed.decision;
      const reason = parsed.reason;

      if (!['complete', 'next', 'fail'].includes(String(decision)) || typeof reason !== 'string' || !reason.trim()) {
        continue;
      }

      const nextDescription = typeof parsed.nextDescription === 'string' && parsed.nextDescription.trim()
        ? parsed.nextDescription.trim()
        : undefined;

      if (decision === 'next' && !nextDescription) {
        continue;
      }

      const confidence = parsed.confidence;
      const nextTaskType = decision === 'next' ? normalizeDecisionTaskType(parsed.nextTaskType) : undefined;

      return {
        decision: decision as AgentEndDecision['decision'],
        reason: reason.trim(),
        nextDescription,
        nextTaskType,
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : undefined,
        unresolvedIssues: Array.isArray(parsed.unresolvedIssues)
          ? parsed.unresolvedIssues.map((item) => String(item).trim()).filter(Boolean).slice(0, 10)
          : undefined,
        confidence: confidence === 'low' || confidence === 'medium' || confidence === 'high' ? confidence : undefined,
      };
    } catch {
      continue;
    }
  }

  return parseDecisionLoose(trimmed);
}

export type AgentEndJudgeRuntime = PluginRuntime & {
  agentEndJudge?: (input: {
    task: Task;
    transcript: string;
    output: ContextStepOutput;
    prompt: string;
    modelRef?: string;
    agentId: string;
  }) => Promise<AgentEndDecision | string | null>;
};

export async function judgeAgentEndWithLlm(params: {
  runtime?: AgentEndJudgeRuntime | null;
  cfg: OpenClawConfig | undefined;
  agentId: string;
  task: Task;
  transcript: string;
  output: ContextStepOutput;
  modelRef?: string;
  timeoutMs?: number;
}): Promise<{ ok: true; decision: AgentEndDecision; raw: string; } | { ok: false; error: string; raw?: string; }> {
  const runtimeJudge = params.runtime?.agentEndJudge;

  if (typeof runtimeJudge === 'function') {
    try {
      const judged = await runtimeJudge({
        task: params.task,
        transcript: params.transcript,
        output: params.output,
        prompt: buildDecisionPrompt({ task: params.task, transcript: params.transcript, output: params.output }),
        modelRef: params.modelRef,
        agentId: params.agentId,
      });

      if (typeof judged === 'string') {
        const parsed = parseDecision(judged);
        return parsed
          ? { ok: true, decision: parsed, raw: judged }
          : { ok: false, error: 'RUNTIME_AGENT_END_JUDGE_PARSE_FAILED', raw: judged };
      }

      if (judged && typeof judged === 'object' && typeof judged.decision === 'string' && typeof judged.reason === 'string') {
        const judgedRecord = judged as Record<string, unknown>;
        if (judged.decision === 'next' && !(typeof judged.nextDescription === 'string' && judged.nextDescription.trim())) {
          return { ok: false, error: 'RUNTIME_AGENT_END_JUDGE_NEXT_WITHOUT_NEXT_DESCRIPTION', raw: JSON.stringify(judged) };
        }

        const normalizedJudged: AgentEndDecision = {
          ...judged,
          nextTaskType: judged.decision === 'next' ? normalizeDecisionTaskType(judgedRecord.nextTaskType) : undefined,
        };

        return { ok: true, decision: normalizedJudged, raw: JSON.stringify(judged) };
      }

      return { ok: false, error: 'RUNTIME_AGENT_END_JUDGE_EMPTY' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const prepared = await prepareSimpleCompletionModelForAgent({
    cfg: params.cfg as OpenClawConfig,
    agentId: params.agentId,
    modelRef: params.modelRef,
  });

  if ('error' in prepared) {
    return { ok: false, error: prepared.error };
  }

  const prompt = buildDecisionPrompt({
    task: params.task,
    transcript: params.transcript,
    output: params.output,
  });

  const context: PiContext = {
    messages: [
      { role: 'user', content: 'You are a strict JSON-only task adjudicator.', timestamp: Date.now() },
      { role: 'user', content: prompt, timestamp: Date.now() + 1 },
    ],
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : undefined;
  const timeoutHandle = timeoutMs && controller
    ? setTimeout(() => controller.abort(new Error(`LLM_DECISION_TIMEOUT:${timeoutMs}`)), timeoutMs)
    : null;

  let assistantMessage;
  try {
    assistantMessage = await completeWithPreparedSimpleCompletionModel({
      model: prepared.model,
      auth: prepared.auth,
      context,
      cfg: params.cfg,
      options: {
        maxTokens: AGENT_END_LLM_MAX_TOKENS,
        ...(controller ? { signal: controller.signal } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      (controller?.signal.aborted && timeoutMs)
      || /LLM_DECISION_TIMEOUT/i.test(message)
      || /aborted/i.test(message)
      || /aborterror/i.test(message)
    ) {
      return { ok: false, error: 'LLM_DECISION_TIMEOUT' };
    }
    return { ok: false, error: message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const raw = extractDecisionRaw(assistantMessage as AssistantMessageLike);
  const stopReason = typeof (assistantMessage as AssistantMessageLike).stopReason === 'string'
    ? (assistantMessage as AssistantMessageLike).stopReason
    : undefined;
  const providerError = typeof (assistantMessage as AssistantMessageLike).errorMessage === 'string'
    ? (assistantMessage as AssistantMessageLike).errorMessage.trim()
    : '';
  const outputTokens = Number((assistantMessage as AssistantMessageLike).usage?.output ?? 0);

  const stopReasonIsErrorLike = stopReason === 'error' || stopReason === 'aborted';
  const stopReasonIsLength = stopReason === 'length';

  if (stopReasonIsErrorLike) {
    if (/aborted|aborterror|request was aborted|timeout/i.test(providerError)) {
      return { ok: false, error: 'LLM_DECISION_TIMEOUT', raw };
    }
    return { ok: false, error: providerError || 'LLM_DECISION_PROVIDER_ERROR', raw };
  }

  if (!raw) {
    if (stopReasonIsLength && outputTokens === 0) {
      return { ok: false, error: 'LLM_DECISION_EMPTY_OUTPUT_LENGTH_LIMIT', raw: '' };
    }
    if (stopReasonIsLength) {
      return { ok: false, error: 'LLM_DECISION_TRUNCATED_EMPTY', raw: '' };
    }
    return { ok: false, error: 'LLM_DECISION_EMPTY_OUTPUT', raw: '' };
  }

  const decision = parseDecision(raw);
  if (!decision) {
    return { ok: false, error: 'LLM_DECISION_PARSE_FAILED', raw };
  }

  return { ok: true, decision, raw };
}
