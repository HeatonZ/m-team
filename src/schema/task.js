/**
 * M-Team Task Schema — 固定任务格式规范
 * @typedef {Object} Task
 * @property {string} taskId
 * @property {string} description
 * @property {string} goal
 * @property {Object} input
 * @property {string} publisher
 * @property {string} status
 * @property {string|null} executor
 * @property {string|null} lastExecutor
 * @property {number} createdAt
 * @property {number|null} claimedAt
 * @property {number|null} completedAt
 * @property {number|null} lastHeartbeatAt
 * @property {string|null} summary
 * @property {Object|null} result
 * @property {string} priority
 */

import fs from 'node:fs';
import path from 'node:path';

// 任务状态枚举
export const TaskStatus = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// 任务优先级枚举
export const TaskPriority = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
};

// 有效优先级列表
export const VALID_PRIORITIES = ['high', 'normal', 'low'];

// ============================================================
// 路径配置（可配置）
// ============================================================

/** @type {string} */
let WORKSPACE_ROOT = '/mnt/d/code/m-team/workspace';

/**
 * @param {string} rootPath
 */
export function setWorkspaceRoot(rootPath) {
  WORKSPACE_ROOT = rootPath;
}

export function getWorkspaceRoot() {
  return WORKSPACE_ROOT;
}

export function getTaskWorkspace(taskId) {
  return path.join(WORKSPACE_ROOT, taskId);
}

export function ensureTaskWorkspace(taskId) {
  const ws = getTaskWorkspace(taskId);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

// ============================================================
// 固定任务格式（不可修改）
// ============================================================

/**
 * @param {unknown} task
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTask(task) {
  const errors = [];

  if (!task || typeof task !== 'object') {
    return { valid: false, errors: ['task 必须是对象'] };
  }

  if (!task.taskId || !task.taskId.startsWith('task_')) {
    errors.push('taskId 格式无效，应为 task_{timestamp}_{random}');
  }
  if (!task.description || typeof task.description !== 'string') {
    errors.push('description 必填且为字符串');
  }
  if (!task.goal || typeof task.goal !== 'string') {
    errors.push('goal 必填且为字符串');
  }
  if (!Object.values(TaskStatus).includes(task.status)) {
    errors.push(`status 无效，可选值: ${Object.values(TaskStatus).join(', ')}`);
  }
  if (task.priority && !VALID_PRIORITIES.includes(task.priority)) {
    errors.push(`priority 无效，可选值: ${VALID_PRIORITIES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {Object} params
 * @param {string} params.description
 * @param {string} params.goal
 * @param {Object} [params.input={}]
 * @param {string} [params.publisher='user']
 * @param {string} [params.priority='normal']
 * @returns {Task}
 */
export function createTask({ description, goal, input = {}, publisher = 'user', priority = 'normal' }) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  return {
    taskId,
    description: String(description),
    goal: String(goal),
    input: input || {},
    priority,
    publisher: publisher || 'user',
    status: TaskStatus.PENDING,
    executor: null,
    lastExecutor: null,
    createdAt: Date.now(),
    claimedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    summary: null,
    result: null
  };
}

export function getStatusLabel(status) {
  const labels = {
    pending: '⏳ 待认领',
    claimed: '🔄 已认领',
    running: '⚙️ 执行中',
    completed: '✅ 完成',
    failed: '❌ 失败'
  };
  return labels[status] || status;
}

export function formatTaskForHuman(task) {
  const priorityLabel = { high: '🔴 高', normal: '🟡 中', low: '🟢 低' };
  const lines = [
    `🎯 ${task.goal}`,
    `📋 当前：${task.description}`,
    `ID: ${task.taskId}`,
    `优先级: ${priorityLabel[task.priority] || '🟡 中'}`,
    `状态: ${getStatusLabel(task.status)}`
  ];
  if (task.executor) lines.push(`执行者: ${task.executor}`);
  if (task.summary) lines.push(`摘要: ${task.summary}`);

  return lines.join('\n');
}

export function getTaskSummary(task) {
  if (task.summary) return task.summary;
  if (!task.result) return '（无结果）';

  if (typeof task.result === 'object') {
    const keys = Object.keys(task.result);
    if (keys.length <= 3) {
      return keys.map(k => `${k}: ${JSON.stringify(task.result[k])}`).join(', ');
    }
    return `结果包含 ${keys.length} 个字段: ${keys.slice(0, 3).join(', ')}...`;
  }
  return String(task.result).substring(0, 200);
}
