import type { OpenClawConfig, PluginRuntime } from 'openclaw/plugin-sdk/core';
import {
  completeWithPreparedSimpleCompletionModel,
  prepareSimpleCompletionModelForAgent,
  extractAssistantText,
} from 'openclaw/plugin-sdk/agent-runtime';
import type { Task, TaskPhase, ContextStepOutput } from '../schema/task.js';

export type AgentEndDecision = {
  decision: 'complete' | 'relay' | 'retain' | 'fail';
  reason: string;
  nextDescription?: string;
  mode?: 'handoff' | 'reworking';
  phase?: TaskPhase;
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
    '你是 m-team 的 agent_end 裁决器。',
    '目标：根据任务整体 goal、当前 description、已有 context、以及本轮 executor transcript，判断任务终态。',
    '你不能直接采信 executor 自称“完成”。必须基于证据判断整个 goal 是否满足。',
    '',
    '允许输出的 decision：complete | relay | retain | fail',
    '规则：',
    '1. complete：只有当前步骤完成、整体 goal 满足、没有待处理问题、没有明确下一步时才允许。',
    '2. relay：已有有效进展，但整体 goal 未完成，且下一步明确可交接。',
    '3. retain：有进展但信息不足以安全 complete/relay，或当前 executor 应继续收口。',
    '4. fail：当前阻塞或无有效进展，且无法形成可执行下一步。',
    '5. 如果 transcript 里出现“下一步：...”，且内容明确，应优先考虑 relay。',
    '6. 如果 transcript 只有模糊完成口径，没有结构化结果/产物/证据，不得 complete。',
    '7. nextDescription 只能是单步、可执行指令；若 decision 不是 relay，可留空。',
    '',
    '请严格只返回 JSON，不要输出 markdown、解释或代码块。',
    'JSON schema:',
    '{',
    '  "decision": "complete|relay|retain|fail",',
    '  "reason": "string",',
    '  "nextDescription": "string (optional)",',
    '  "mode": "handoff|reworking (optional)",',
    '  "phase": "executing|finalizing (optional, only for retain)",',
    '  "summary": "string (optional)",',
    '  "unresolvedIssues": ["string", ...] (optional),',
    '  "confidence": "low|medium|high"',
    '}',
    '',
    `goal: ${task.goal}`,
    `current_description: ${task.description}`,
    `current_phase: ${task.lifecycle.phase}`,
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
      if (!['complete', 'relay', 'retain', 'fail'].includes(String(decision)) || typeof reason !== 'string' || !reason.trim()) {
        continue;
      }
      const mode = parsed.mode;
      const phase = parsed.phase;
      const confidence = parsed.confidence;
      return {
        decision: decision as AgentEndDecision['decision'],
        reason: reason.trim(),
        nextDescription: typeof parsed.nextDescription === 'string' && parsed.nextDescription.trim() ? parsed.nextDescription.trim() : undefined,
        mode: mode === 'handoff' || mode === 'reworking' ? mode : undefined,
        phase: phase === 'executing' || phase === 'finalizing' ? phase as TaskPhase : undefined,
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
      const judged = await (runtimeJudge as (input: {
        task: Task;
        transcript: string;
        output: ContextStepOutput;
        prompt: string;
        modelRef?: string;
        agentId: string;
      }) => Promise<AgentEndDecision | string | null>)({
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

  const assistantMessage = await completeWithPreparedSimpleCompletionModel({
    model: prepared.model,
    auth: prepared.auth,
    context: [
      { role: 'system', content: 'You are a strict JSON-only task adjudicator.' },
      { role: 'user', content: prompt },
    ],
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
