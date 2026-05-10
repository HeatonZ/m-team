/**
 * M-Team 任务池 — 内部写操作（需要事务的操作）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  openDb,
  getDb,
  closeDb,
  isDbOpen,
  getTaskRow,
  updateTaskRow,
  insertTask,
} from './db';
import {
  LifecycleDecision,
  TaskPhase,
  TaskStatus,
  TaskPriority,
  type Task,
  type TaskPatch,
  type TaskLifecycle,
  type ContextStepEntry,
  type ContextStepOutput,
  createDefaultLifecycle,
  createTask,
  normalizeTask,
} from '../schema/task';

let WORKSPACE_ROOT = '/mnt/d/code/m-team';
export let DB_PATH: string | null = null;

export function setWorkspaceRoot(root: string): void {
  WORKSPACE_ROOT = root;
  DB_PATH = path.join(root, 'queue', 'm-team.db');
  if (isDbOpen()) closeDb();
}

function getTasksDir(): string {
  return path.join(WORKSPACE_ROOT, 'tasks');
}

function getTaskPath(taskId: string): string {
  return path.join(getTasksDir(), taskId, 'task.json');
}

function syncTaskJson(task: Task): void {
  const p = getTaskPath(task.taskId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(normalizeTask(task), null, 2), 'utf8');
}

function init(): void {
  if (!DB_PATH) return;
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  openDb(DB_PATH);
}

function fingerprintText(text: string | undefined | null): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。,.!！?？;；:：]/g, '');
}

function fingerprintOutput(output: ContextStepOutput | undefined): string {
  if (!output) return '';
  const picked = {
    summary: output.summary ?? '',
    files: output.files ?? [],
    dataRefs: output.dataRefs ?? [],
    unresolvedIssues: output.unresolvedIssues ?? [],
    metrics: output.metrics ?? {}
  };
  return JSON.stringify(picked);
}

function cloneLifecycle(task: Task): TaskLifecycle {
  return JSON.parse(JSON.stringify(task.lifecycle ?? createDefaultLifecycle())) as TaskLifecycle;
}

function patchLifecycleWithProgress(
  task: Task,
  phase: TaskPhase,
  decision: keyof typeof LifecycleDecision,
  nextDescription: string | undefined,
  contextOutput?: ContextStepOutput,
  counters?: { handoffDelta?: number; reworkDelta?: number }
): TaskLifecycle {
  const prev = cloneLifecycle(task);
  const nextDescFp = fingerprintText(nextDescription ?? task.description);
  const nextContextFp = fingerprintOutput(contextOutput);
  const lastDescFp = prev.loopGuard.lastDescriptionFingerprint ?? '';
  const lastContextFp = prev.loopGuard.lastContextFingerprint ?? '';
  const hasProgress = Boolean(nextContextFp) && nextContextFp !== lastContextFp;

  return {
    phase,
    handoffCount: prev.handoffCount + (counters?.handoffDelta ?? 0),
    reworkCount: prev.reworkCount + (counters?.reworkDelta ?? 0),
    lastDecision: LifecycleDecision[decision],
    lastDecisionAt: Date.now(),
    loopGuard: {
      samePhaseCount: prev.phase === phase ? prev.loopGuard.samePhaseCount + 1 : 1,
      sameDescriptionCount: lastDescFp === nextDescFp ? prev.loopGuard.sameDescriptionCount + 1 : 1,
      noProgressCount: hasProgress ? 0 : prev.loopGuard.noProgressCount + 1,
      lastDescriptionFingerprint: nextDescFp,
      lastContextFingerprint: nextContextFp || lastContextFp,
      lastProgressAt: hasProgress ? Date.now() : prev.loopGuard.lastProgressAt,
    }
  };
}

function appendContext(task: Task, executorId: string | null, contextEntry: ContextStepInput | null): ContextStepEntry[] {
  const current = task.context ?? [];
  if (!contextEntry) return current;
  return [
    ...current,
    {
      type: 'step',
      executor: executorId || task.executor || 'unknown',
      step: contextEntry.step,
      output: (contextEntry.output ?? {}) as ContextStepEntry['output'],
      completedAt: Date.now()
    }
  ];
}

function setTaskState(
  taskId: string,
  patch: TaskPatch,
): Task {
  updateTaskRow(taskId, patch);
  const updated = normalizeTask(getTaskRow(taskId)!);
  syncTaskJson(updated);
  return updated;
}

// ============================================================
// 写操作
// ============================================================

export function publishTask(input: {
  taskType?: string;
  description: string;
  goal: string;
  publisher?: string;
  priority?: string;
}): string {
  init();

  const { taskType, description, goal, publisher, priority } = input;
  const task = createTask({
    taskType: taskType as import('../schema/task').TaskType | undefined,
    description,
    goal,
    publisher,
    priority: priority as TaskPriority | undefined
  });

  const db = getDb();
  db.transaction(() => {
    insertTask(task);
    syncTaskJson(task);
  })();

  console.log(`[m-team-pool] 任务发布: ${task.taskId} - ${input.description}`);
  return task.taskId;
}

export interface ClaimResult {
  success: boolean;
  taskId: string;
  task?: Task;
  reason?: string;
}

export function claimTask(taskId: string, agentId: string): ClaimResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, taskId, reason: 'TASK_NOT_FOUND' };
    if (task.status !== TaskStatus.PENDING) return { success: false, taskId, reason: 'NOT_PENDING' };

    const existingActive = db.prepare(
      'SELECT task_id FROM tasks WHERE executor = ? AND status = ?'
    ).get(agentId, TaskStatus.RUNNING);
    if (existingActive) return { success: false, taskId, reason: 'ALREADY_HAS_ACTIVE_TASK' };

    const lifecycle = patchLifecycleWithProgress(task, TaskPhase.EXECUTING, 'RETAIN', task.description, undefined);
    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, lifecycle = ?, updated_at = ? WHERE task_id = ? AND status = ?'
    ).run(
      TaskStatus.RUNNING,
      agentId,
      task.executor !== null ? task.executor : task.lastExecutor,
      JSON.stringify(lifecycle),
      Date.now(),
      taskId,
      TaskStatus.PENDING
    );

    if (updated.changes === 0) {
      return { success: false, taskId, reason: 'ALREADY_CLAIMED' };
    }

    const updatedTask = normalizeTask(getTaskRow(taskId)!);
    syncTaskJson(updatedTask);
    console.log(`[m-team-pool] ${agentId} 认领了任务 ${taskId}`);
    return { success: true, taskId, task: updatedTask };
  })();

  return result as ClaimResult;
}

export interface ContextStepInput {
  step: string;
  output?: ContextStepOutput;
}

export function updateTask(
  taskId: string,
  status: string | null,
  contextEntry: ContextStepInput | null,
  description: string | null,
  updatedAt: number | null,
  executorId: string | null
): Task | null {
  init();
  const task = getTaskRow(taskId);
  if (!task) return null;

  const context = appendContext(task, executorId, contextEntry);
  const lifecycle = patchLifecycleWithProgress(
    task,
    task.lifecycle.phase,
    'RETAIN',
    description ?? task.description,
    contextEntry?.output,
  );

  return setTaskState(taskId, {
    ...(status ? { status: status as Task['status'] } : {}),
    ...(description ? { description } : {}),
    ...(updatedAt ? { updatedAt } : { updatedAt: Date.now() }),
    context: JSON.stringify(context),
    lifecycle: JSON.stringify(lifecycle),
  });
}

export interface CancelResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function cancelTask(taskId: string): CancelResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if ([TaskStatus.CLOSED, TaskStatus.CANCELLED].includes(task.status)) return { success: false, reason: 'TASK_ALREADY_TERMINAL' };

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.CANCELLED,
      executor: null,
      updatedAt: Date.now(),
      lifecycle: JSON.stringify({
        ...task.lifecycle,
        lastDecision: LifecycleDecision.FAIL,
        lastDecisionAt: Date.now(),
      })
    })
  };
}

export interface RelinquishResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function relinquishTask(taskId: string, reason?: string): RelinquishResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };

  const context = reason
    ? appendContext(task, task.executor, { step: '主动放弃当前任务', output: { summary: reason, unresolvedIssues: [reason] } })
    : task.context;
  const lifecycle = patchLifecycleWithProgress(task, TaskPhase.REWORKING, 'RELAY', task.description, undefined, { reworkDelta: 1 });

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: task.executor,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
      lifecycle: JSON.stringify(lifecycle),
    })
  };
}

export interface RelayResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function relayTask(
  taskId: string,
  executorId: string,
  contextEntry: ContextStepInput | null,
  description?: string,
  mode: 'handoff' | 'reworking' = 'handoff'
): RelayResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CANCELLED) return { success: false, reason: 'TASK_CANCELLED' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (task.executor !== executorId) return { success: false, reason: 'NOT_CURRENT_EXECUTOR' };

  const nextDescription = description?.trim() || task.description;
  const context = appendContext(task, executorId, contextEntry);
  const lifecycle = patchLifecycleWithProgress(
    task,
    mode === 'reworking' ? TaskPhase.REWORKING : TaskPhase.HANDOFF,
    'RELAY',
    nextDescription,
    contextEntry?.output,
    mode === 'reworking' ? { reworkDelta: 1 } : { handoffDelta: 1 }
  );

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId,
      description: nextDescription,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
      lifecycle: JSON.stringify(lifecycle),
    })
  };
}

export interface RetainResult {
  success: boolean;
  task: Task | null;
  reason?: string;
}

export function retainTaskOwnership(
  taskId: string,
  executorId: string,
  contextEntry: ContextStepInput | null,
  description: string | undefined,
  phase: TaskPhase = TaskPhase.EXECUTING,
): RetainResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CANCELLED) return { success: false, task: null, reason: 'TASK_CANCELLED' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, task: null, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (task.executor !== executorId) return { success: false, task: null, reason: 'NOT_CURRENT_EXECUTOR' };

  const context = appendContext(task, executorId, contextEntry);
  const lifecycle = patchLifecycleWithProgress(task, phase, 'RETAIN', description ?? task.description, contextEntry?.output);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.RUNNING,
      executor: executorId,
      description: description ?? task.description,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
      lifecycle: JSON.stringify(lifecycle),
    })
  };
}

export interface CompleteResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function completeTask(
  taskId: string,
  contextEntry: ContextStepInput | null,
  fallbackEntry?: { outcome?: string; error?: string }
): CompleteResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };

  const context = appendContext(task, task.executor, contextEntry ?? (fallbackEntry ? {
    step: '任务完成',
    output: {
      summary: fallbackEntry.outcome,
      error: fallbackEntry.error,
    }
  } : null));
  const lifecycle = patchLifecycleWithProgress(task, TaskPhase.DONE, 'COMPLETE', task.description, contextEntry?.output);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now(),
      executor: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
      lifecycle: JSON.stringify(lifecycle),
    })
  };
}

export interface FailResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function failTask(
  taskId: string,
  reason: string,
  contextEntry: ContextStepInput | null,
  fallbackEntry?: { outcome?: string; error?: string }
): FailResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (![TaskStatus.RUNNING, TaskStatus.PENDING].includes(task.status)) return { success: false, reason: `TASK_NOT_MUTABLE_${task.status}` };

  const context = appendContext(task, task.executor, contextEntry ?? {
    step: '任务失败',
    output: {
      summary: fallbackEntry?.outcome ?? reason,
      error: fallbackEntry?.error ?? reason,
      unresolvedIssues: [reason]
    }
  });
  const lifecycle = patchLifecycleWithProgress(task, task.lifecycle.phase, 'FAIL', task.description, contextEntry?.output);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.FAILED,
      completedAt: Date.now(),
      executor: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
      lifecycle: JSON.stringify(lifecycle),
    })
  };
}

export interface CloseResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function closeTask(taskId: string, publisher?: string): CloseResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.COMPLETED) return { success: false, reason: `TASK_NOT_COMPLETED_${task.status}` };
  if (publisher && task.publisher !== publisher) return { success: false, reason: 'PUBLISHER_MISMATCH' };

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.CLOSED,
      updatedAt: Date.now(),
      lifecycle: JSON.stringify({
        ...task.lifecycle,
        phase: TaskPhase.DONE,
      })
    })
  };
}
