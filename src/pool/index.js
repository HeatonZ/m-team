/**
 * M-Team 任务池 — 对外 API（只读查询 + 通知格式化）
 *
 * 写操作（publishTask, claimTask, updateTask, cancelTask,
 * relinquishTask, completeTask, failTask）见 operations.js
 */

// pool/index.js 是只读查询层，setWorkspaceRoot 逻辑由 operations.js 提供
export { setWorkspaceRoot } from './operations.js';
import { openDb, getDb, getTaskRow, getAllTaskRows, getTaskRowsByStatus, getTaskRowByExecutor } from './db.js';
import { TaskStatus } from '../schema/task.js';
import '../pool/operations.js'; // 确保 operations.js init

function init() {
  // DB_PATH 由 operations.js 在 openDb 时设置
}

// ============================================================
// 只读查询
// ============================================================

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

// ============================================================
// 通知格式化
// ============================================================

export function formatTaskNotifications(task, notifications = []) {
  if (!notifications || notifications.length === 0) return [];
  if (!task || task.status !== 'completed') return [];

  const result = [];
  for (const cfg of notifications) {
    if (!cfg.agents || !cfg.agents.includes(task.executor)) continue;

    const duration = task.completedAt && task.claimedAt
      ? `${Math.round((task.completedAt - task.claimedAt) / 1000)}秒`
      : null;

    if (cfg.provider === 'feishu') {
      result.push({
        provider: 'feishu',
        chatId: cfg.groupId,
        message: [
          `✅ 任务完成`,
          ``,
          `📋 ${task.description}`,
          `执行者: ${task.executor}`,
          task.summary ? `结果: ${task.summary}` : null,
          duration ? `耗时: ${duration}` : null,
        ].filter(Boolean).join('\n')
      });
    } else if (cfg.provider === 'discord') {
      result.push({
        provider: 'discord',
        channelId: cfg.channelId,
        message: [
          `✅ **${task.description}**`,
          task.summary ? `_${task.summary}_` : null,
          `执行者: ${task.executor}${duration ? ` | 耗时: ${duration}` : ''}`,
        ].filter(Boolean).join('\n')
      });
    }
  }

  return result;
}
