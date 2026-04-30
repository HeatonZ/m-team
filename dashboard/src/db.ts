/**
 * Dashboard DB Layer
 * Wraps m-team/pool with WORKSPACE_ROOT setup.
 */

import { openDb, getDb, getTaskRow, getAllTaskRows, getTaskRowsByStatus, getTaskRowByExecutor } from 'm-team/pool/db';
import { TaskStatus } from 'm-team/schema/task';

// Dashboard types (absolute import to avoid tsx relative path bug)
import type { Task, TaskPriority } from '/mnt/d/code/m-team/dashboard/src/types/task';
import { STATUS_LABELS, PRIORITY_LABELS } from '/mnt/d/code/m-team/dashboard/src/types/task';

export { TaskStatus, STATUS_LABELS, PRIORITY_LABELS };
export type { Task, TaskPriority };

let _dbPath: string | null = null;

export function setWorkspaceRoot(root: string): void {
  _dbPath = `${root}/queue/m-team.db`;
  openDb(_dbPath);
}

function ensureInit(): void {
  if (!getDb()) throw new Error('[dashboard] DB not initialized — call setWorkspaceRoot first');
}

export function getAllTasks() {
  ensureInit();
  return getAllTaskRows();
}

export function getTask(taskId: string) {
  ensureInit();
  return getTaskRow(taskId);
}

export function getPendingTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.PENDING);
}

export function getRunningTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.RUNNING);
}

export function getCompletedTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.COMPLETED);
}

export function getFailedTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.FAILED);
}

export function getCancelledTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.CANCELLED);
}

export function getAgentActiveTask(agentId: string) {
  ensureInit();
  return getTaskRowByExecutor(agentId);
}
