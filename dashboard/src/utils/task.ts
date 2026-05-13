import type { Task, ContextStepEntry } from '../types/task';

export type HeatBucket = 'fresh' | 'aging' | 'stale';

const BLOCK_KEYWORDS = [
  'blocked',
  'blocker',
  'permission',
  'auth',
  'external',
  'dependency',
  'failed',
  'cannot continue',
  '无法继续',
  '阻塞',
  '权限',
  '依赖',
  '失败',
];

export function getLatestStep(task: Task): ContextStepEntry | undefined {
  return [...task.context].reverse().find((entry) => entry.type === 'step');
}

export function getLatestSummary(task: Task): string {
  const latest = getLatestStep(task);
  return latest?.output?.summary || latest?.step || 'No latest summary.';
}

export function getLatestIssues(task: Task): string[] {
  return getLatestStep(task)?.output?.unresolvedIssues ?? [];
}

export function getLatestFiles(task: Task): string[] {
  return getLatestStep(task)?.output?.files ?? [];
}

export function getHeatBucket(updatedAt: number): HeatBucket {
  const ageMinutes = Math.max(0, (Date.now() - updatedAt) / 60_000);
  if (ageMinutes < 10) return 'fresh';
  if (ageMinutes < 30) return 'aging';
  return 'stale';
}

export function isBlockedTask(task: Task): boolean {
  const issues = getLatestIssues(task);
  return issues.some((issue) => {
    const lower = issue.toLowerCase();
    return BLOCK_KEYWORDS.some((token) => lower.includes(token.toLowerCase()));
  });
}
