/**
 * M-Team 任务池 — 对外 API
 *
 * 读操作（带 init） → pool/index.js 自有实现，底层调用 db.js
 * 写操作 → operations.js
 * 通知格式化 → notifications.js
 */

export { setWorkspaceRoot } from './operations.js';
export { completeTask, failTask } from './operations.js';
export { publishTask, claimTask, updateTask, relinquishTask, relayTask, cancelTask } from './operations.js';

export { formatTaskNotifications, formatRelinquishNotifications } from '../notifications.js';

// ============================================================
// 只读查询（带 init 封装）
// ============================================================

import { openDb, getDb, getTaskRow, getAllTaskRows, getTaskRowsByStatus, getTaskRowByExecutor } from './db.js';
import { TaskStatus } from '../schema/task.js';
import { setWorkspaceRoot, DB_PATH } from './operations.js';
import './operations.js'; // 确保 operations.js init

function init() {
  // DB_PATH 由 operations.js 在 setWorkspaceRoot 时设置
  // 纯读操作（如 getTask）需要确保 DB 已打开
  if (DB_PATH) openDb(DB_PATH);
}

export function getPendingTasks(agentId = null) {
  init();

  if (agentId && getAgentActiveTask(agentId)) return [];

  const rows = getTaskRowsByStatus(TaskStatus.PENDING);
  return rows.slice(0, 3);
}

export function getAgentActiveTask(agentId) {
  init();
  return getTaskRowByExecutor(agentId);
}

export function getTask(taskId) {
  init();
  return getTaskRow(taskId);
}

export function getAllTasks() {
  init();
  return getAllTaskRows();
}

export function getTasksByExecutor(agentId) {
  init();
  return getAllTaskRows().filter(t => t.executor === agentId);
}
