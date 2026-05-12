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
  TaskStatus,
  TaskPriority,
  type Task,
  type TaskPatch,
  type ContextStepEntry,
  type ContextStepOutput,
  type StepContract,
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

function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.FAILED
    || status === TaskStatus.CANCELLED
    || status === TaskStatus.CLOSED;
}

// ============================================================
// 写操作
// ============================================================

export function publishTask(input: {
  taskType?: string;
  description: string;
  goal: string;
  stepContract?: import('../schema/task').StepContract;
  publisher?: string;
  priority?: string;
}): string {
  init();

  const { taskType, description, goal, stepContract, publisher, priority } = input;
  const task = createTask({
    taskType: taskType as import('../schema/task').TaskType | undefined,
    description,
    goal,
    stepContract,
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

    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, updated_at = ? WHERE task_id = ? AND status = ?'
    ).run(
      TaskStatus.RUNNING,
      agentId,
      task.executor !== null ? task.executor : task.lastExecutor,
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
  stepContract: StepContract | null,
  updatedAt: number | null,
  executorId: string | null
): Task | null {
  init();
  const task = getTaskRow(taskId);
  if (!task) return null;

  if (status && isTerminalStatus(task.status) && status !== task.status) {
    throw new Error(`TASK_TERMINAL_${task.status.toUpperCase()}_IMMUTABLE`);
  }

  const context = appendContext(task, executorId, contextEntry);

  return setTaskState(taskId, {
    ...(status ? { status: status as Task['status'] } : {}),
    ...(description ? { description } : {}),
    ...(stepContract ? { stepContract: JSON.stringify(stepContract) } : {}),
    ...(updatedAt ? { updatedAt } : { updatedAt: Date.now() }),
    context: JSON.stringify(context),
  });
}

export interface CancelResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function cancelTask(taskId: string, _publisher?: string, reason?: string): CancelResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CLOSED || task.status === TaskStatus.CANCELLED) {
    return { success: false, reason: 'TASK_ALREADY_TERMINAL' };
  }

  const context = reason
    ? appendContext(task, task.executor, { step: '任务取消', output: { summary: reason } })
    : task.context;

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.CANCELLED,
      executor: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    })
  };
}

export interface RelinquishResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function relinquishTask(taskId: string, executorId?: string, reason?: string): RelinquishResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (executorId && task.executor && executorId !== task.executor) return { success: false, reason: 'NOT_CURRENT_EXECUTOR' };

  const context = reason
    ? appendContext(task, task.executor, { step: '主动放弃当前任务', output: { summary: reason, unresolvedIssues: [reason] } })
    : task.context;

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: task.executor,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    })
  };
}

export interface NextResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function nextTask(
  taskId: string,
  executorId: string,
  contextEntry: ContextStepInput | null,
  description?: string,
  stepContract?: StepContract,
): NextResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CANCELLED) return { success: false, reason: 'TASK_CANCELLED' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (task.executor !== executorId) return { success: false, reason: 'NOT_CURRENT_EXECUTOR' };

  const nextDescription = description?.trim() || task.description;
  const context = appendContext(task, executorId, contextEntry);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId,
      description: nextDescription,
      ...(stepContract ? { stepContract: JSON.stringify(stepContract) } : {}),
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    })
  };
}

export interface CompleteResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export interface RejectResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function rejectTask(
  taskId: string,
  publisher: string,
  reason: string,
  description?: string | null,
  stepContract?: StepContract,
): RejectResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.COMPLETED) {
    return { success: false, reason: `TASK_NOT_COMPLETED_${task.status}` };
  }
  if (task.publisher !== publisher) {
    return { success: false, reason: 'PUBLISHER_MISMATCH' };
  }

  const context = appendContext(task, null, {
    step: reason,
    output: {},
  });

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      description: description?.trim() || task.description,
      ...(stepContract ? { stepContract: JSON.stringify(stepContract) } : {}),
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    })
  };
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

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now(),
      executor: null,
      lastExecutor: task.executor ?? task.lastExecutor,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
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
  if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
    return { success: false, reason: `TASK_NOT_MUTABLE_${task.status}` };
  }

  const context = appendContext(task, task.executor, contextEntry ?? {
    step: '任务失败',
    output: {
      summary: fallbackEntry?.outcome ?? reason,
      error: fallbackEntry?.error ?? reason,
      unresolvedIssues: [reason]
    }
  });

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.FAILED,
      completedAt: Date.now(),
      executor: null,
      lastExecutor: task.executor ?? task.lastExecutor,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
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
    })
  };
}
