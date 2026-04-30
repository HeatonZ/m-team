/**
 * M-Team 任务池 — 对外 API（读操作 + 写操作导出）
 */

import { openDb, getTaskRow, getAllTaskRows, getTaskRowsByStatus, getTaskRowByExecutor } from './db';
import { TaskStatus, type Task } from '../schema/task';
import { setWorkspaceRoot, DB_PATH } from './operations';
import {
  publishTask,
  claimTask,
  updateTask,
  relinquishTask,
  relayTask,
  cancelTask,
  completeTask,
  failTask,
  type ClaimResult,
  type CancelResult,
  type RelinquishResult,
  type RelayResult,
  type CompleteResult,
  type ContextEntryInput
} from './operations';

// ============================================================
// 写操作（透传 from operations）
// ============================================================

export { setWorkspaceRoot, DB_PATH };
export { publishTask, claimTask, updateTask, relinquishTask, relayTask, cancelTask, completeTask, failTask };
export type { ClaimResult, CancelResult, RelinquishResult, RelayResult, CompleteResult, ContextEntryInput };

// ============================================================
// 只读查询
// ============================================================

function init(): void {
  if (DB_PATH) openDb(DB_PATH);
}

export function getPendingTasks(agentId?: string | null): Task[] {
  init();
  if (agentId && getAgentActiveTask(agentId)) return [];
  return getTaskRowsByStatus(TaskStatus.PENDING);
}

export function getAgentActiveTask(agentId: string): Task | null {
  init();
  return getTaskRowByExecutor(agentId);
}

export function getTask(taskId: string): Task | null {
  init();
  return getTaskRow(taskId);
}

export function getAllTasks(): Task[] {
  init();
  return getAllTaskRows();
}

export function getTasksByExecutor(agentId: string): Task[] {
  init();
  return getAllTaskRows().filter(t => {
    if (t.executor === agentId || t.lastExecutor === agentId) return true;
    return t.context.some((e) => (e as { type: string; executor?: string }).type === 'step' && (e as { executor: string }).executor === agentId);
  });
}
