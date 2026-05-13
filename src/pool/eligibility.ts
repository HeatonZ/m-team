import type { Task } from '../schema/task.js';

const CROSS_BORDER_ECOM_KEYWORDS: RegExp[] = [
  /跨境/u,
  /\b1688\b/i,
  /\bshopee\b/i,
  /\blisting\b/i,
  /妙手/u,
  /\berp\b/i,
  /采集箱/u,
  /代发/u,
  /选品/u,
];

function buildTaskDomainText(task: Task): string {
  const contextSteps = task.context
    .filter((entry) => entry.type === 'step')
    .slice(-6)
    .map((entry) => `${entry.step}\n${entry.output?.summary ?? ''}`)
    .join('\n');
  return [task.description, task.goal, contextSteps].filter(Boolean).join('\n');
}

export function isCrossBorderEcommerceTask(task: Task): boolean {
  const text = buildTaskDomainText(task);
  return CROSS_BORDER_ECOM_KEYWORDS.some((rule) => rule.test(text));
}

export function canAgentClaimTask(task: Task, agentId: string): { ok: true } | { ok: false; reason: string } {
  if (agentId === 'scholar' && isCrossBorderEcommerceTask(task)) {
    return { ok: false, reason: 'AGENT_TASK_DOMAIN_MISMATCH' };
  }
  return { ok: true };
}

