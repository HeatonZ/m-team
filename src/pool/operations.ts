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
  type ContextStepEntry,
  createTask
} from '../schema/task';

let WORKSPACE_ROOT = '/mnt/d/code/m-team';
export let DB_PATH: string | null = null;

export function setWorkspaceRoot(root: string): void {
  WORKSPACE_ROOT = root;
  DB_PATH = path.join(root, 'queue', 'm-team.db');
  // 工作空间路径变了必须关闭旧连接
  if (isDbOpen()) {
    closeDb();
  }
}

function getTasksDir(): string {
  return path.join(WORKSPACE_ROOT, 'tasks');
}

function getTaskPath(taskId: string): string {
  return path.join(getTasksDir(), taskId, 'task.json');
}

/** 同步 task.json 代理文件（供 agents 直接读文件系统） */
function syncTaskJson(task: Task): void {
  const p = getTaskPath(task.taskId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(task, null, 2), 'utf8');
}

function init(): void {
  if (!DB_PATH) return;
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  openDb(DB_PATH);
}

// ============================================================
// 写操作
// ============================================================

export function publishTask(input: {
  description: string;
  goal: string;
  input?: Record<string, unknown>;
  publisher?: string;
  priority?: string;
  sessionKey?: string;
}): string {
  init();

  const { description, goal, input: inputData, publisher, priority, sessionKey } = input;
  const task = createTask({ description, goal, input: inputData, publisher, priority: priority as TaskPriority | undefined });

  const db = getDb();
  db.transaction(() => {
    insertTask(task);
    syncTaskJson(task);
  })();

  console.log(`[m-team-pool] 任务发布: ${task.taskId} - ${input.description}`);
  return task.taskId;
}

// ============================================================
// claimTask
// ============================================================

export interface ClaimResult {
  success: boolean;
  taskId: string;
  task?: Task;
  reason?: string;
}

export function claimTask(taskId: string, agentId: string, sessionKey?: string): ClaimResult {
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

    const newLastExecutor = task.executor !== null ? task.executor : task.lastExecutor;

    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, last_heartbeat_at = ? WHERE task_id = ? AND status = ?'
    ).run(TaskStatus.RUNNING, agentId, newLastExecutor, Date.now(), taskId, TaskStatus.PENDING);

    if (updated.changes === 0) {
      return { success: false, taskId, reason: 'ALREADY_CLAIMED' };
    }

    const updatedTask = getTaskRow(taskId)!;
    syncTaskJson(updatedTask);
    console.log(`[m-team-pool] ${agentId} 认领了任务 ${taskId}`);
    return { success: true, taskId, task: updatedTask };
  })();

  return result as ClaimResult;
}

// ============================================================
// updateTask
// ============================================================

export interface ContextEntryInput {
  step: string;
  output?: Record<string, unknown>;
}

export function updateTask(
  taskId: string,
  status: string | null,
  contextEntry: ContextEntryInput | null,
  description: string | null,
  lastHeartbeatAt: number | null,
  executorId: string | null
): Task | null {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return null;

    // cancelled 任务处理
    if (task.status === TaskStatus.CANCELLED) {
      if (status === TaskStatus.PENDING) {
        return task; // relay 被拒绝，保持 cancelled
      }
      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        const patch: Record<string, unknown> = { status: status as Task['status'], completedAt: Date.now() };
        updateTaskRow(taskId, patch);
        const updated = getTaskRow(taskId)!;
        syncTaskJson(updated);
        return updated;
      }
      // 只追加 context 或心跳
      if (contextEntry) {
        const newContext = [...task.context];
        newContext.push({
          type: 'step',
          executor: executorId || task.executor || 'unknown',
          step: contextEntry.step,
          output: (contextEntry.output ?? {}) as ContextStepEntry['output'],
          completedAt: Date.now()
        });
        updateTaskRow(taskId, { context: JSON.stringify(newContext) });
        const updated = getTaskRow(taskId)!;
        syncTaskJson(updated);
        return updated;
      }
      return task;
    }

    // relay：重新放回 pending
    if (status === TaskStatus.PENDING) {
      const patch: Record<string, unknown> = {
        status: TaskStatus.PENDING,
        executor: null,
        lastExecutor: task.executor ?? null,
        description: description ?? task.description,
        lastHeartbeatAt: lastHeartbeatAt ?? null
      };
      if (contextEntry) {
        const newContext = [...task.context];
        newContext.push({
          type: 'step',
          executor: executorId || task.executor || 'unknown',
          step: contextEntry.step,
          output: (contextEntry.output ?? {}) as ContextStepEntry['output'],
          completedAt: Date.now()
        });
        patch.context = JSON.stringify(newContext);
      }
      updateTaskRow(taskId, patch);
      const updated = getTaskRow(taskId)!;
      syncTaskJson(updated);
      return updated;
    }

    // 普通状态更新
    if (status) {
      const patch: Record<string, unknown> = { status: status as Task['status'] };
      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        patch.completedAt = Date.now();
      }
      if (description) patch.description = description;
      if (lastHeartbeatAt) patch.lastHeartbeatAt = lastHeartbeatAt;
      updateTaskRow(taskId, patch);
    } else {
      if (lastHeartbeatAt) updateTaskRow(taskId, { lastHeartbeatAt });
      if (description) updateTaskRow(taskId, { description });
    }

    // 追加 context 步骤
    if (contextEntry) {
      const current = getTaskRow(taskId)!;
      const newContext = [...current.context];
      newContext.push({
        type: 'step',
        executor: executorId || current.executor || 'unknown',
        step: contextEntry.step,
        output: (contextEntry.output ?? {}) as ContextStepEntry['output'],
        completedAt: Date.now()
      });
      updateTaskRow(taskId, { context: JSON.stringify(newContext) });
    }

    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);
    console.log(`[m-team-pool] 任务 ${taskId} 状态: ${status}`);
    return updated;
  })();

  return result as Task | null;
}

// ============================================================
// cancelTask
// ============================================================

export interface CancelResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function cancelTask(taskId: string, publisher: string, reason?: string, sessionKey?: string): CancelResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.publisher !== publisher) return { success: false, task, reason: 'NOT_PUBLISHER' };
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return { success: false, task, reason: 'ALREADY_TERMINAL' };
    }

    const patch: Record<string, unknown> = {
      status: TaskStatus.CANCELLED,
      executor: null,
      completedAt: Date.now()
    };
    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);
    console.log(`[m-team-pool] 任务 ${taskId} 被 ${publisher} 取消: ${reason ?? '无原因'}`);
    return { success: true, task: updated };
  })();

  return result as CancelResult;
}

// ============================================================
// relinquishTask
// ============================================================

export interface RelinquishResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function relinquishTask(
  taskId: string,
  executorId: string,
  reason: string = 'executor_relinquish',
  sessionKey?: string
): RelinquishResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.status === TaskStatus.CANCELLED) return { success: false, task, reason: 'TASK_CANCELLED' };
    if (task.status !== TaskStatus.RUNNING) return { success: false, task, reason: `TASK_NOT_RUNNING_${task.status}` };
    if (task.executor !== executorId) return { success: false, task, reason: 'NOT_CURRENT_EXECUTOR' };

    const newContext = [...task.context];
    newContext.push({
      type: 'step',
      executor: executorId,
      step: reason,
      output: { relinquish: true } as ContextStepEntry['output'],
      completedAt: Date.now()
    });

    const patch: Record<string, unknown> = {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId,
      context: JSON.stringify(newContext)
    };
    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);
    console.log(`[m-team-pool] executor ${executorId} 放弃任务 ${taskId}: ${reason}`);
    return { success: true, task: updated };
  })();

  return result as RelinquishResult;
}

// ============================================================
// relayTask
// ============================================================

export interface RelayResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function relayTask(
  taskId: string,
  executorId: string,
  contextEntry: ContextEntryInput,
  heartbeat?: number,
  description?: string,
  sessionKey?: string
): RelayResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.status === TaskStatus.CANCELLED) return { success: false, task: null, reason: 'TASK_CANCELLED' };
    if (task.status !== TaskStatus.RUNNING) return { success: false, task: null, reason: `TASK_NOT_RUNNING_${task.status}` };
    if (task.executor !== executorId) return { success: false, task: null, reason: 'NOT_CURRENT_EXECUTOR' };

    const newContext = [...task.context];
    newContext.push({
      type: 'step',
      executor: executorId,
      step: contextEntry.step,
      output: (contextEntry.output ?? {}) as ContextStepEntry['output'],
      completedAt: Date.now()
    });

    const patch: Record<string, unknown> = {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId,
      context: JSON.stringify(newContext),
      ...(description !== undefined && { description })
    };
    if (heartbeat !== undefined) patch.lastHeartbeatAt = heartbeat;

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);
    console.log(`[m-team-pool] executor ${executorId} 交接任务 ${taskId}（relay）`);
    return { success: true, task: updated };
  })();

  return result as RelayResult;
}

// ============================================================
// completeTask
// ============================================================

export interface CompleteResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function completeTask(
  taskId: string,
  contextEntry: ContextEntryInput | null,
  fallbackEntry?: { outcome?: string; error?: string },
  sessionKey?: string
): CompleteResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };

    if (task.status !== TaskStatus.RUNNING) {
      return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
    }

    const patch: Record<string, unknown> = {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now(),
      executor: null
    };

    const entryToAdd = contextEntry ?? fallbackEntry;
    if (entryToAdd) {
      const newContext = [...task.context];
      newContext.push({
        type: 'step',
        executor: task.executor || 'unknown',
        step: (entryToAdd as ContextEntryInput).step || (entryToAdd as { outcome?: string }).outcome || 'completed',
        output: (typeof (entryToAdd as ContextEntryInput).output !== 'undefined'
          ? (entryToAdd as ContextEntryInput).output
          : (entryToAdd as { error?: string }).error ? { error: (entryToAdd as { error?: string }).error } : {}) as ContextStepEntry['output'],
        completedAt: Date.now()
      });
      patch.context = JSON.stringify(newContext);
    }

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);

    const source = contextEntry ? 'executor' : 'hook';
    console.log(`[m-team-pool] 任务 ${taskId} 完成（${source}）`);
    return { success: true, task: updated };
  })();

  return result as CompleteResult;
}

// ============================================================
// failTask
// ============================================================

export function failTask(
  taskId: string,
  errorMsg: string | null,
  contextEntry?: ContextEntryInput,
  fallbackEntry?: { outcome?: string; error?: string },
  sessionKey?: string
): CompleteResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };

    if (task.status !== TaskStatus.RUNNING) {
      return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
    }

    const patch: Record<string, unknown> = {
      status: TaskStatus.FAILED,
      completedAt: Date.now(),
      executor: null
    };

    const entryToAdd = contextEntry ?? fallbackEntry;
    if (entryToAdd) {
      const newContext = [...task.context];
      newContext.push({
        type: 'step',
        executor: task.executor || 'unknown',
        step: (entryToAdd as ContextEntryInput).step || (entryToAdd as { outcome?: string }).outcome || 'failed',
        output: (typeof (entryToAdd as ContextEntryInput).output !== 'undefined'
          ? (entryToAdd as ContextEntryInput).output
          : (entryToAdd as { error?: string }).error ? { error: (entryToAdd as { error?: string }).error } : { error: errorMsg }) as ContextStepEntry['output'],
        completedAt: Date.now()
      });
      patch.context = JSON.stringify(newContext);
    }

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);

    console.log(`[m-team-pool] 任务 ${taskId} 失败（${contextEntry ? 'executor' : 'hook'}）: ${errorMsg ?? ''}`);
    return { success: true, task: updated };
  })();

  return result as CompleteResult;
}

// ============================================================
// closeTask（Publisher 验收通过，终态）
// ============================================================

export interface CloseResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function closeTask(taskId: string, publisher: string, sessionKey?: string): CloseResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.status !== TaskStatus.COMPLETED) {
      return { success: false, task, reason: `NOT_COMPLETED_${task.status}` };
    }
    if (task.publisher !== publisher) {
      return { success: false, task, reason: 'NOT_PUBLISHER' };
    }

    const patch: Record<string, unknown> = {
      status: TaskStatus.CLOSED,
      completedAt: Date.now(),
      executor: null
    };
    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId)!;
    syncTaskJson(updated);
    console.log(`[m-team-pool] 任务 ${taskId} 被 ${publisher} 验收关闭`);
    return { success: true, task: updated };
  })();

  return result as CloseResult;
}
