import type { OpenClawConfig, PluginRuntime } from 'openclaw/plugin-sdk/core';
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
  extractAssistantText,
} from 'openclaw/plugin-sdk/agent-runtime';
import type { Context as PiContext } from '@mariozechner/pi-ai';
import type { Task, ContextStepOutput } from '../schema/task.js';

export type AgentEndDecision = {
  decision: 'complete' | 'next' | 'fail';
  reason: string;
  nextDescription?: string;
  nextStepContract?: {
    expectedOutcome?: string;
    doneWhen: string[];
    constraints?: string[];
    inputHints?: string[];
  };
  summary?: string;
  unresolvedIssues?: string[];
  confidence?: 'low' | 'medium' | 'high';
};

function buildDecisionPrompt(params: {
  task: Task;
  transcript: string;
  output: ContextStepOutput;
}): string {
  const { task, transcript, output } = params;
  const contextLines = task.context
    .filter(entry => entry.type === 'step')
    .slice(-8)
    .map((entry, index) => {
      const files = entry.output?.files?.length ? ` | files=${entry.output.files.join(', ')}` : '';
      const issues = entry.output?.unresolvedIssues?.length ? ` | issues=${entry.output.unresolvedIssues.join(' ; ')}` : '';
      return `${index + 1}. step=${entry.step}\n   summary=${entry.output?.summary ?? ''}${files}${issues}`;
    })
    .join('\n');

  return [
    'You are the m-team agent_end adjudicator.',
    'Decide the task state from the overall goal, the current description, recent context, and the executor transcript.',
    'Do not trust an executor claiming completion unless the evidence supports it.',
    '',
    '[Language rule]',
    '- Your JSON keys must stay in English.',
    '- All natural-language field values must be in Chinese.',
    '- reason, summary, unresolvedIssues, nextDescription, expectedOutcome, doneWhen, constraints, and inputHints should all be written in Chinese.',
    '- Do not translate code, JSON keys, API fields, or file paths.',
    '',
    'Allowed decisions: complete | next | fail',
    'Rules:',
    '1. complete: only when the current step is complete, the overall goal is satisfied, there are no unresolved issues, and there is no clear next step.',
    '2. next: use when there is valid progress but the overall goal is not finished, or the current step exposed a clear next action.',
    '2.1 When decision=next, provide nextDescription. It must be one step only, concise, and actionable.',
    '2.2 Prefer to also provide nextStepContract with at least expectedOutcome and doneWhen.',
    '3. fail: use only when the task is blocked or there is no safe executable next step.',
    '4. Avoid drift. Judge progress only against the current description, not unrelated side work.',
    '5. The executor reports facts and problems. agent_end decides the next action.',
    '6. nextDescription must describe only the next current step. Do not paste history, long problem text, or whole-task commentary into it.',
    '7. If the transcript is vague and lacks evidence, do not return complete.',
    '',
    'Return JSON only. No markdown. No code fences.',
    'JSON schema:',
    '{',
    '  "decision": "complete|next|fail",',
    '  "reason": "string in Chinese",',
    '  "nextDescription": "string in Chinese (required when decision=next)",',
    '  "nextStepContract": { "expectedOutcome": "string in Chinese", "doneWhen":["..."], "constraints":["..."], "inputHints":["..."] } (optional),',
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

function parseDecision(raw: string): AgentEndDecision | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
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
      return {
        decision: decision as AgentEndDecision['decision'],
        reason: reason.trim(),
        nextDescription,
        nextStepContract: parsed.nextStepContract && typeof parsed.nextStepContract === 'object'
          ? parsed.nextStepContract as AgentEndDecision['nextStepContract']
          : undefined,
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : undefined,
        unresolvedIssues: Array.isArray(parsed.unresolvedIssues)
          ? parsed.unresolvedIssues.map(item => String(item).trim()).filter(Boolean).slice(0, 10)
          : undefined,
        confidence: confidence === 'low' || confidence === 'medium' || confidence === 'high' ? confidence : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
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
        return parsed ? { ok: true, decision: parsed, raw: judged } : { ok: false, error: 'RUNTIME_AGENT_END_JUDGE_PARSE_FAILED', raw: judged };
      }
      if (judged && typeof judged === 'object' && typeof judged.decision === 'string' && typeof judged.reason === 'string') {
        if (judged.decision === 'next' && !(typeof judged.nextDescription === 'string' && judged.nextDescription.trim())) {
          return { ok: false, error: 'RUNTIME_AGENT_END_JUDGE_NEXT_WITHOUT_NEXT_DESCRIPTION', raw: JSON.stringify(judged) };
        }
        return { ok: true, decision: judged, raw: JSON.stringify(judged) };
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

  const assistantMessage = await completeWithPreparedSimpleCompletionModel({
    model: prepared.model,
    auth: prepared.auth,
    context,
    cfg: params.cfg,
    options: { maxTokens: 500 },
  });

  const raw = extractAssistantText(assistantMessage)?.trim() ?? '';
  const decision = parseDecision(raw);
  if (!decision) {
    return { ok: false, error: 'LLM_DECISION_PARSE_FAILED', raw };
  }
  return { ok: true, decision, raw };
}
