export const TASK_CONTRACT_LIMITS = {
  goalMaxLength: 200,
  descriptionMaxLength: 120,
  summaryMaxLength: 500,
  issueMaxLength: 180,
  filePathMaxLength: 240,
  maxFiles: 20,
  maxIssues: 10,
  maxContextSteps: 40,
  agentEndNextDescriptionMaxLength: 80,
  agentEndMaxUnresolvedIssues: 3,
  agentEndRecentContextLimit: 8,
} as const;

export const GOAL_INLINE_HINT = 'Final success state only (acceptance target), not step-by-step execution details.';
export const DESCRIPTION_INLINE_HINT = 'Current baton only: one step, one action, single-line, executable now.';
export const CONTEXT_OUTPUT_INLINE_HINT = 'Current baton output only: summary, files, unresolvedIssues, error.';
export const AGENT_END_DECISION_INLINE_HINT = 'decision=complete|next|fail; next requires nextDescription and nextTaskType.';

const MULTI_STEP_PATTERN = /([;；]|然后|接着|最后|then\b|finally\b|step\s+\d+|步骤\s*\d+|(?:^|\s)\d+\.\s+)/iu;
const DESCRIPTION_GOAL_DRIFT_PATTERN = /(整体任务|最终交付|全部完成|验收|close task)/iu;
const GOAL_PROCEDURAL_PATTERN = /(then\b|finally\b|step\s+\d+|步骤\s*\d+|先.+(然后|再|最后)|然后|接着|最后|;|；)/iu;

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function hasMultiStepPattern(text: string): boolean {
  return MULTI_STEP_PATTERN.test(text);
}

export function hasDescriptionGoalDrift(text: string): boolean {
  return DESCRIPTION_GOAL_DRIFT_PATTERN.test(text);
}

export function hasGoalProceduralPattern(text: string): boolean {
  return GOAL_PROCEDURAL_PATTERN.test(text);
}

export function buildGoalQualityRules(): string {
  return [
    'Goal quality rules:',
    '- goal means final acceptance target only.',
    '- do not write step-by-step process in goal.',
    '- keep goal concise and verifiable.',
    '- goal must not be identical to description.',
  ].join('\n');
}

export function buildContextOutputQualityRules(): string {
  return [
    'Context output contract (current baton only):',
    '- summary: concise factual step result.',
    '- files: artifact paths or identifiers produced in this step.',
    '- unresolvedIssues: remaining blockers after this step.',
    '- error: primary blocker if this step is blocked.',
  ].join('\n');
}

export function buildAgentEndDecisionContractBlock(): string {
  return [
    'Agent-end decision contract:',
    '- decision: complete | next | fail.',
    '- reason: concise, factual, Chinese natural language.',
    '- nextDescription: required when decision=next, one-step current baton only.',
    '- nextTaskType: required when decision=next, must be one of the allowed task types.',
    '- unresolvedIssues: at most 3 concise items in decision output.',
  ].join('\n');
}

export function sanitizeSingleLine(text: string): string {
  return normalizeLine(text);
}
