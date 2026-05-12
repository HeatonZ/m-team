/**
 * Task display and sanitization helpers.
 */

import type { StepContract, Task } from '../schema/task.js';
import { PRIORITY_LABELS, TASK_TYPE_LABELS, getStatusLabel } from '../schema/task.js';

export function sanitizeTask(task: Task): Omit<Task, 'goal'> {
  const { goal: _goal, ...sanitized } = task;
  return sanitized;
}

export function sanitizeTaskList(tasks: Task[]): Array<Omit<Task, 'goal'>> {
  return tasks.map(sanitizeTask);
}

export interface ExecutorTaskView {
  taskId: string;
  taskType: Task['taskType'];
  description: string;
  stepContract?: StepContract;
  priority: Task['priority'];
  publisher: string;
  status: Task['status'];
  executor: string | null;
  lastExecutor: string | null;
  createdAt: number;
  updatedAt: number;
  recentContext: Array<{
    executor: string;
    step: string;
    summary?: string;
    files?: string[];
    unresolvedIssueCount?: number;
    completedAt: number;
  }>;
}

function compactText(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined;
  const normalized = text
    .replace(/```[\s\S]*?```/g, ' [code block omitted] ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max)}?` : normalized;
}

function recentContextLines(task: Task): string[] {
  const steps = task.context.filter(e => e.type === 'step');
  if (steps.length === 0) return [];
  return steps.slice(-3).map((entry, idx, arr) => {
    const n = steps.length - arr.length + idx + 1;
    const summary = compactText(entry.output?.summary, 100);
    const issueCount = (entry.output?.unresolvedIssues ?? []).filter(issue => !/^(\*+)?\s*?/i.test(issue)).length;
    const fileCount = entry.output?.files?.length ?? 0;
    const parts = [`Step ${n}`, `[${entry.executor}]`, compactText(entry.step, 60) ?? ''];
    if (summary) parts.push(`summary: ${summary}`);
    if (fileCount > 0) parts.push(`files ${fileCount}`);
    if (issueCount > 0) parts.push(`issues ${issueCount}`);
    return parts.filter(Boolean).join(' ? ');
  });
}

export function buildExecutorTaskView(task: Task): ExecutorTaskView {
  const recentContext = task.context
    .filter(entry => entry.type === 'step')
    .slice(-3)
    .map(entry => ({
      executor: entry.executor,
      step: compactText(entry.step, 100) ?? entry.step,
      ...(compactText(entry.output?.summary, 140) ? { summary: compactText(entry.output?.summary, 140) } : {}),
      ...(entry.output?.files?.length ? { files: entry.output.files.slice(0, 5) } : {}),
      ...(entry.output?.unresolvedIssues?.length
        ? { unresolvedIssueCount: entry.output.unresolvedIssues.filter(issue => !/^(\*+)?\s*?/i.test(issue)).length }
        : {}),
      completedAt: entry.completedAt,
    }));

  return {
    taskId: task.taskId,
    taskType: task.taskType,
    description: task.description,
    ...(task.stepContract ? { stepContract: task.stepContract } : {}),
    priority: task.priority,
    publisher: task.publisher,
    status: task.status,
    executor: task.executor,
    lastExecutor: task.lastExecutor,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    recentContext,
  };
}

export function buildExecutorTaskViewList(tasks: Task[]): ExecutorTaskView[] {
  return tasks.map(buildExecutorTaskView);
}

export function formatTaskLine(task: Omit<Task, 'goal'>, index: number): string {
  const priority = PRIORITY_LABELS[task.priority] ?? 'Normal';
  const stepCount = task.context.length;
  const taskType = TASK_TYPE_LABELS[task.taskType] ?? task.taskType;
  return `${index}. [${priority}] [${taskType}] ${task.taskId} ? ${task.description}${stepCount > 0 ? ` (${stepCount} steps)` : ''}`;
}

export function formatTaskAsText(task: Task, options?: { includeGoal?: boolean }): string {
  const status = getStatusLabel(task.status);
  const priority = PRIORITY_LABELS[task.priority] ?? 'Normal';
  const stepCount = task.context.filter(e => e.type === 'step').length;
  const includeGoal = options?.includeGoal ?? false;

  const lines = [
    'Task detail',
    `ID: ${task.taskId}`,
    `Type: ${TASK_TYPE_LABELS[task.taskType] ?? task.taskType}`,
    `Status: ${status}`,
    `Priority: ${priority}`,
  ];
  if (includeGoal) lines.push(`Goal: ${task.goal}`);
  lines.push(`Current step: ${task.description}`);

  if (task.stepContract?.expectedOutcome) {
    lines.push('\n[Expected outcome]');
    lines.push(`- ${task.stepContract.expectedOutcome}`);
  }
  if (task.stepContract?.doneWhen?.length) {
    lines.push('\n[Done when]');
    for (const item of task.stepContract.doneWhen.slice(0, 4)) lines.push(`- ${item}`);
  }
  if (task.stepContract?.constraints?.length) {
    lines.push('\n[Constraints]');
    for (const item of task.stepContract.constraints.slice(0, 4)) lines.push(`- ${item}`);
  }
  if (task.stepContract?.inputHints?.length) {
    lines.push('\n[Input hints]');
    for (const item of task.stepContract.inputHints.slice(0, 3)) lines.push(`- ${item}`);
  }

  lines.push(`Publisher: ${task.publisher}`);
  if (task.executor) lines.push(`Executor: ${task.executor}`);
  if (task.lastExecutor) lines.push(`Last executor: ${task.lastExecutor}`);
  lines.push(`Completed steps: ${stepCount}`);
  lines.push(`Created at: ${new Date(task.createdAt).toISOString()}`);

  const recent = recentContextLines(task);
  if (recent.length > 0) {
    lines.push('\n[Recent history]');
    lines.push(...recent);
  }

  lines.push('\nExecute only the current step above. Do not expand into a whole-task plan.');
  return lines.join('\n');
}

export function formatTaskListAsText(tasks: Task[], label = 'Task list'): string {
  if (tasks.length === 0) return `${label} is empty`;

  const lines = [`${label} (${tasks.length})`, ''];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const status = getStatusLabel(t.status);
    const priority = PRIORITY_LABELS[t.priority] ?? 'Normal';
    const taskType = TASK_TYPE_LABELS[t.taskType] ?? t.taskType;
    lines.push(`${i + 1}. [${priority}] ${status} ${t.taskId}`);
    lines.push(`   ${taskType}`);
    lines.push(`   ${t.description}`);
    if (t.executor) lines.push(`   executor: ${t.executor}`);
    if (t.lastExecutor) lines.push(`   last executor: ${t.lastExecutor}`);
    lines.push('');
  }

  return lines.join('\n');
}
