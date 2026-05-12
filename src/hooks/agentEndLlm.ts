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
    expectedOutputs: Array<{ kind: 'file' | 'json' | 'text' | 'report' | 'code_change' | 'command_result'; path?: string; name?: string; formatHint?: string; required?: boolean }>;
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
    '你是 m-team 的 agent_end 裁决器。',
    '目标：根据任务整体 goal、当前 description、已有 context、以及本轮 executor transcript，判断任务终态。',
    '你不能直接采信 executor 自称“完成”。必须基于证据判断整个 goal 是否满足。',
    '',
    '允许输出的 decision：complete | next | fail',
    '规则：',
    '1. complete：只有当前步骤完成、整体 goal 满足、没有待处理问题、没有明确下一步时才允许。',
    '2. next：已有有效进展，但整体 goal 未完成，或已明确暴露出下一步需要解决的问题。next 时必须提供 nextDescription，且必须是单步、可执行指令。',
    '2.1 next 时应尽量同时提供 nextStepContract：至少包含 expectedOutputs 和 doneWhen，用来约束下一步交付质量。',
    '3. fail：当前阻塞或无有效进展，且无法形成可执行下一步。',
    '5. 优先避免任务偏移：不要因为 executor 顺手做了别的事就把无关工作判成进展，必须围绕当前 description 判断。',
    '6. executor 的职责是报告结果和问题，不是自己扩展成长链修复计划；问题解决通常应由 agent_end 转成下一步。',
    '7. 如果发现问题但仍有清晰的下一步修复动作，应优先输出 next，并把问题解决写成下一步 description。',
    '8. M-Team 不预设必须由同一个 agent 还是另一个 agent 执行下一步；统一回池，由下一次认领取得执行权。',
    '9. 如果无法安全判断 complete/next，优先输出 next；只有在明确阻塞且无推进路径时才输出 fail。',
    '10. 如果 transcript 只有模糊完成口径，没有结构化结果/产物/证据，不得 complete。',
    '11. nextDescription 只能写“当前下一步要干什么”，不能重复塞历史摘要、问题长文、context、executor 复盘或整段旧 description。',
    '12. nextDescription 应尽量短，聚焦一个当前动作；步骤历史和问题细节留在 context，不要写进 description。',
    '',
    '请严格只返回 JSON，不要输出 markdown、解释或代码块。',
    'JSON schema:',
    '{',
    '  "decision": "complete|next|fail",',
    '  "reason": "string",',
    '  "nextDescription": "string (optional, required when decision=next)",',
    '  "nextStepContract": { "expectedOutputs": [{"kind":"report","path":"..."}], "doneWhen":["..."], "constraints":["..."], "inputHints":["..."] } (optional, recommended when decision=next),',
    '  "summary": "string (optional)",',
    '  "unresolvedIssues": ["string", ...] (optional),',
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
