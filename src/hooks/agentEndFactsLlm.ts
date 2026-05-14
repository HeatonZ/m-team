import type { OpenClawConfig, PluginRuntime } from 'openclaw/plugin-sdk/core';
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
  extractAssistantVisibleText,
  extractAssistantText,
} from 'openclaw/plugin-sdk/agent-runtime';
import type { Context as PiContext } from '@mariozechner/pi-ai';
import type { ContextStepOutput, Task } from '../schema/task.js';
import { TASK_CONTRACT_LIMITS } from '../task-contract.js';

export type AgentEndFacts = ContextStepOutput;

type AssistantMessageLike = {
  stopReason?: string;
  errorMessage?: string;
  usage?: { output?: number };
  content?: unknown;
};

const AGENT_END_FACTS_MAX_TOKENS = 1000;

const GOAL_DRIFT_PATTERN = /(整体任务|最终目标|最终答案|goal|下一步|next step|publisher|close task|关闭任务|任务已完成|wait(?:ing)? for publisher)/iu;
const NON_ISSUE_PATTERN = /^(none|n\/a|无|暂无|无未解决问题|no issues?|no unresolved issues?)$/iu;

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

function extractRaw(message: AssistantMessageLike): string {
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

function normalizeSingleLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trim();
}

function normalizeSummary(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeSingleLine(raw, TASK_CONTRACT_LIMITS.summaryMaxLength);
  if (!normalized) return undefined;
  let stripped = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !GOAL_DRIFT_PATTERN.test(line))
    .join(' ')
    .trim();
  stripped = stripped
    .replace(/[。；;，,]\s*(任务完成|已完成任务|task complete(?:d)?|goal achieved)\s*$/iu, '')
    .replace(/\s*(任务完成|已完成任务|task complete(?:d)?|goal achieved)\s*$/iu, '')
    .trim();
  return stripped || undefined;
}

function normalizeFileToken(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^[`"'“”‘’]+/u, '').replace(/[`"'“”‘’]+$/u, '');
  text = text.replace(/\s*[（(][^()]{0,40}(?:现有|内容|行|line|追加|两行)[^()]*[)）]\s*$/iu, '');
  text = text.replace(/[`，。；：,;!?]+$/u, '');
  text = text.trim();
  if (text.length > TASK_CONTRACT_LIMITS.filePathMaxLength) {
    text = text.slice(0, TASK_CONTRACT_LIMITS.filePathMaxLength).trim();
  }
  return text;
}

function isLikelyFileToken(text: string): boolean {
  if (!text) return false;
  if (/^[A-Za-z]:\\/.test(text)) return true;
  if (text.startsWith('/')) return true;
  if (/[\\/]/.test(text) && /\.[a-z0-9]{1,8}$/i.test(text)) return true;
  if (/^[\w.-]+\.[a-z0-9]{1,8}$/i.test(text)) return true;
  return false;
}

function normalizeFiles(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && raw.trim() ? raw.split(/[,\n]/) : []);

  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of source) {
    if (typeof item !== 'string') continue;
    const token = normalizeFileToken(item);
    if (!isLikelyFileToken(token)) continue;
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
    if (output.length >= TASK_CONTRACT_LIMITS.maxFiles) break;
  }

  return output;
}

function normalizeIssue(raw: string): string {
  return normalizeSingleLine(raw, TASK_CONTRACT_LIMITS.issueMaxLength);
}

function isValidIssue(issue: string): boolean {
  if (!issue) return false;
  if (NON_ISSUE_PATTERN.test(issue)) return false;
  if (GOAL_DRIFT_PATTERN.test(issue)) return false;
  return true;
}

function normalizeIssues(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' && raw.trim() ? raw.split(/[;\n；]/) : []);

  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of source) {
    if (typeof item !== 'string') continue;
    const issue = normalizeIssue(item);
    if (!isValidIssue(issue)) continue;
    if (seen.has(issue)) continue;
    seen.add(issue);
    output.push(issue);
    if (output.length >= TASK_CONTRACT_LIMITS.maxIssues) break;
  }

  return output;
}

function normalizeError(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeSingleLine(raw, TASK_CONTRACT_LIMITS.issueMaxLength);
  if (!normalized) return undefined;
  if (NON_ISSUE_PATTERN.test(normalized)) return undefined;
  if (GOAL_DRIFT_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function normalizeFacts(raw: Record<string, unknown>): AgentEndFacts {
  const summary = normalizeSummary(raw.summary);
  const files = normalizeFiles(raw.files);
  const unresolvedIssues = normalizeIssues(raw.unresolvedIssues);
  const error = normalizeError(raw.error);

  return {
    ...(summary ? { summary } : {}),
    ...(files.length ? { files } : {}),
    ...(unresolvedIssues.length ? { unresolvedIssues } : {}),
    ...(error ? { error } : {}),
  };
}

function parseFacts(raw: string): AgentEndFacts | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  const latestJson = extractLatestJsonObject(trimmed);
  if (latestJson) candidates.push(latestJson);
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const objectSlice = trimmed.match(/\{[\s\S]*\}/u)?.[0];
  if (objectSlice) candidates.push(objectSlice);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object') continue;
      const facts = normalizeFacts(parsed as Record<string, unknown>);
      return facts;
    } catch {
      continue;
    }
  }

  return null;
}

function buildPrompt(params: {
  task: Task;
  transcript: string;
  output: ContextStepOutput;
}): string {
  const { task, transcript, output } = params;
  const recent = task.context
    .filter((entry) => entry.type === 'step')
    .slice(-TASK_CONTRACT_LIMITS.agentEndRecentContextLimit)
    .map((entry, index) => `${index + 1}. step=${entry.step}\n   summary=${entry.output?.summary ?? ''}`)
    .join('\n');

  return [
    'You are m-team facts cleaner.',
    'Task: extract ONLY current-step execution facts from transcript.',
    'Do NOT judge task completion; do NOT write next step.',
    '',
    '[Hard rules]',
    '1) summary = factual result of current step only (Chinese).',
    '2) files = concrete output files from current step only.',
    '3) unresolvedIssues = blockers that still remain AFTER this step.',
    '4) error = primary blocker (only if blocked).',
    '5) Never mention whole-task judgment, goal completion, publisher, close task, or next step.',
    '6) Keep it concise and verifiable.',
    '',
    'Return JSON only, no markdown, no extra text.',
    'Schema:',
    '{',
    '  "summary": "string (optional)",',
    '  "files": ["string", ...],',
    '  "unresolvedIssues": ["string", ...],',
    '  "error": "string (optional)"',
    '}',
    '',
    `goal_for_reference_only: ${task.goal}`,
    `current_description: ${task.description}`,
    `hint_summary: ${output.summary ?? ''}`,
    `hint_files: ${(output.files ?? []).join(', ')}`,
    `hint_unresolved_issues: ${(output.unresolvedIssues ?? []).join(' ; ')}`,
    '',
    'recent_context:',
    recent || '(empty)',
    '',
    'current_transcript:',
    transcript || '(empty)',
  ].join('\n');
}

export type AgentEndFactsCleanerRuntime = PluginRuntime & {
  agentEndFactsCleaner?: (input: {
    task: Task;
    transcript: string;
    output: ContextStepOutput;
    prompt: string;
    modelRef?: string;
    agentId: string;
  }) => Promise<AgentEndFacts | string | null>;
};

export async function cleanAgentEndFactsWithLlm(params: {
  runtime?: AgentEndFactsCleanerRuntime | null;
  cfg: OpenClawConfig | undefined;
  agentId: string;
  task: Task;
  transcript: string;
  output: ContextStepOutput;
  modelRef?: string;
  timeoutMs?: number;
}): Promise<{ ok: true; facts: AgentEndFacts; raw: string; } | { ok: false; error: string; raw?: string; }> {
  const runtimeCleaner = params.runtime?.agentEndFactsCleaner;
  const prompt = buildPrompt({
    task: params.task,
    transcript: params.transcript,
    output: params.output,
  });

  if (typeof runtimeCleaner === 'function') {
    try {
      const cleaned = await runtimeCleaner({
        task: params.task,
        transcript: params.transcript,
        output: params.output,
        prompt,
        modelRef: params.modelRef,
        agentId: params.agentId,
      });

      if (typeof cleaned === 'string') {
        const parsed = parseFacts(cleaned);
        return parsed
          ? { ok: true, facts: parsed, raw: cleaned }
          : { ok: false, error: 'RUNTIME_FACTS_CLEAN_PARSE_FAILED', raw: cleaned };
      }

      if (cleaned && typeof cleaned === 'object') {
        const facts = normalizeFacts(cleaned as Record<string, unknown>);
        return { ok: true, facts, raw: JSON.stringify(cleaned) };
      }

      return { ok: false, error: 'RUNTIME_FACTS_CLEAN_EMPTY' };
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

  const context: PiContext = {
    messages: [
      { role: 'user', content: 'You are a strict JSON-only facts cleaner.', timestamp: Date.now() },
      { role: 'user', content: prompt, timestamp: Date.now() + 1 },
    ],
  };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : undefined;
  const timeoutHandle = timeoutMs && controller
    ? setTimeout(() => controller.abort(new Error(`LLM_FACTS_CLEAN_TIMEOUT:${timeoutMs}`)), timeoutMs)
    : null;

  let assistantMessage;
  try {
    assistantMessage = await completeWithPreparedSimpleCompletionModel({
      model: prepared.model,
      auth: prepared.auth,
      context,
      cfg: params.cfg,
      options: {
        maxTokens: AGENT_END_FACTS_MAX_TOKENS,
        ...(controller ? { signal: controller.signal } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      (controller?.signal.aborted && timeoutMs)
      || /LLM_FACTS_CLEAN_TIMEOUT/i.test(message)
      || /aborted/i.test(message)
      || /aborterror/i.test(message)
    ) {
      return { ok: false, error: 'LLM_FACTS_CLEAN_TIMEOUT' };
    }
    return { ok: false, error: message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const raw = extractRaw(assistantMessage as AssistantMessageLike);
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
      return { ok: false, error: 'LLM_FACTS_CLEAN_TIMEOUT', raw };
    }
    return { ok: false, error: providerError || 'LLM_FACTS_CLEAN_PROVIDER_ERROR', raw };
  }

  if (!raw) {
    if (stopReasonIsLength && outputTokens === 0) {
      return { ok: false, error: 'LLM_FACTS_CLEAN_EMPTY_OUTPUT_LENGTH_LIMIT', raw: '' };
    }
    if (stopReasonIsLength) {
      return { ok: false, error: 'LLM_FACTS_CLEAN_TRUNCATED_EMPTY', raw: '' };
    }
    return { ok: false, error: 'LLM_FACTS_CLEAN_EMPTY_OUTPUT', raw: '' };
  }

  const facts = parseFacts(raw);
  if (!facts) {
    return { ok: false, error: 'LLM_FACTS_CLEAN_PARSE_FAILED', raw };
  }

  return { ok: true, facts, raw };
}
