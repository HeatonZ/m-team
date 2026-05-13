/**
 * M-Team 任务池 — 对外 API（读操作 + 写操作导出）
 */

import { openDb, getTaskRow, getTaskRowByExecutor } from './db';
import { getTaskRowsByStatus as _db_getTaskRowsByStatus, getAllTaskRows as _db_getAllTaskRows } from './db';
import { TaskStatus, type Task } from '../schema/task';
import { setWorkspaceRoot, DB_PATH } from './operations';
import { canAgentClaimTask } from './claim-routing.js';
import {
  publishTask,
  claimTask,
  updateTask,
  relinquishTask,
  rejectTask,
  nextTask,
  cancelTask,
  completeTask,
  failTask,
  closeTask,
  type ClaimResult,
  type CancelResult,
  type RelinquishResult,
  type CompleteResult,
  type CloseResult,
  type ContextStepInput,
} from './operations';

export { setWorkspaceRoot, DB_PATH };
export { publishTask, claimTask, updateTask, relinquishTask, nextTask, cancelTask, completeTask, failTask, closeTask };
export { rejectTask };
export type { ClaimResult, CancelResult, RelinquishResult, CompleteResult, CloseResult, ContextStepInput };
export { getTaskLogs } from './db';
export type { TaskLog, TaskLogInput } from './db';

function init(): void {
  if (DB_PATH) openDb(DB_PATH);
}

export function getTaskRowsByStatus(status: string): Task[] {
  init();
  return _db_getTaskRowsByStatus(status);
}

export function getAllTasks(): Task[] {
  init();
  return _db_getAllTaskRows();
}

export function getRunningTasks(): Task[] {
  init();
  return getTaskRowsByStatus(TaskStatus.RUNNING);
}

export function getPendingTasks(agentId?: string | null): Task[] {
  init();
  if (agentId && getAgentActiveTask(agentId)) return [];
  const pending = getTaskRowsByStatus(TaskStatus.PENDING);
  if (!agentId) return pending;
  return pending.filter(task => canAgentClaimTask(task, agentId).ok);
}

export function getAgentActiveTask(agentId: string): Task | null {
  init();
  return getTaskRowByExecutor(agentId);
}

export function getTask(taskId: string): Task | null {
  init();
  return getTaskRow(taskId);
}

export function getCompletedTasks(): Task[] {
  init();
  return getTaskRowsByStatus(TaskStatus.COMPLETED);
}

export function getFailedTasks(): Task[] {
  init();
  return getTaskRowsByStatus(TaskStatus.FAILED);
}

export function getCancelledTasks(): Task[] {
  init();
  return getTaskRowsByStatus(TaskStatus.CANCELLED);
}

export function getClosedTasks(): Task[] {
  init();
  return getTaskRowsByStatus(TaskStatus.CLOSED);
}

export function getTasksByExecutor(agentId: string): Task[] {
  init();
  return _db_getAllTaskRows().filter(t => {
    if (t.executor === agentId || t.lastExecutor === agentId) return true;
    return t.context.some((e) => e.executor === agentId);
  });
}
