/**
 * Dashboard DB Layer
 * Wraps m-team/pool/db.js with WORKSPACE_ROOT setup.
 */

import { openDb, getDb, getTaskRow, getAllTaskRows, getTaskRowsByStatus, getTaskRowByExecutor } from '../../src/pool/db.js';
import { TaskStatus } from './schema/task.js';

export { TaskStatus };

let _dbPath = null;

export function setWorkspaceRoot(root) {
  _dbPath = `${root}/queue/m-team.db`;
  openDb(_dbPath);
}

function ensureInit() {
  if (!getDb()) throw new Error('[dashboard] DB not initialized — call setWorkspaceRoot first');
}

export function getAllTasks() {
  ensureInit();
  return getAllTaskRows();
}

export function getTask(taskId) {
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

export function getAgentActiveTask(agentId) {
  ensureInit();
  return getTaskRowByExecutor(agentId);
}

export const STATUS_LABELS = {
  [TaskStatus.PENDING]:    '⏳ 待认领',
  [TaskStatus.RUNNING]:    '⚙️ 执行中',
  [TaskStatus.COMPLETED]:  '✅ 完成',
  [TaskStatus.FAILED]:     '❌ 失败',
  [TaskStatus.CANCELLED]:  '🚫 已取消'
};

export const PRIORITY_LABELS = {
  high:   '🔴 高',
  normal: '🟡 中',
  low:    '🟢 低'
};
