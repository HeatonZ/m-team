/**
 * M-Team Task Schema — 固定任务格式规范
 * @typedef {Object} Task
 * @property {string} taskId
 * @property {string} description
 * @property {string} goal
 * @property {Array} context
 * @property {string} publisher
 * @property {string} status
 * @property {string|null} executor
 * @property {string|null} lastExecutor
 * @property {number} createdAt
 * @property {number|null} completedAt
 * @property {number|null} lastHeartbeatAt
 * @property {string} priority
 */

import fs from 'node:fs';
import path from 'node:path';

// 任务状态枚举
export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
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
// 路径配置
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
  if (!Array.isArray(task.context)) {
    errors.push('context 必填且为数组');
  } else {
    // context[0] 必须是 input
    if (task.context.length > 0 && task.context[0]?.type !== 'input') {
      errors.push('context[0].type 必须是 "input"');
    }
    // 后续 entries 必须有 executor + step
    for (let i = 1; i < task.context.length; i++) {
      const entry = task.context[i];
      if (!entry || typeof entry !== 'object') {
        errors.push(`context[${i}] 必须是对象`);
        continue;
      }
      if (!entry.executor || typeof entry.executor !== 'string') {
        errors.push(`context[${i}].executor 必填且为字符串`);
      }
      if (!entry.step || typeof entry.step !== 'string') {
        errors.push(`context[${i}].step 必填且为字符串`);
      }
    }
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
  const taskId = `task_${Math.floor(Date.now() / 1000)}`;

  return {
    taskId,
    description: String(description),
    goal: String(goal),
    context: [
      {
        type: 'input',
        data: input || {},
        createdAt: Date.now()
      }
    ],
    priority,
    publisher: publisher || 'user',
    status: TaskStatus.PENDING,
    executor: null,
    lastExecutor: null,
    createdAt: Date.now(),
    completedAt: null,
    lastHeartbeatAt: null
  };
}

export function getStatusLabel(status) {
  const labels = {
    pending: '⏳ 待认领',
    running: '⚙️ 执行中',
    completed: '✅ 完成',
    failed: '❌ 失败',
    cancelled: '🚫 已取消'
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

  const stepCount = task.context.length - 1; // 排除 input
  if (stepCount === 0) {
    lines.push('📝 还未开始执行');
  } else {
    lines.push(`📝 已完成 ${stepCount} 步`);
  }

  if (task.executor) lines.push(`执行者: ${task.executor}`);
  if (task.lastExecutor) lines.push(`上一步: ${task.lastExecutor}`);

  return lines.join('\n');
}

export function getTaskSummary(task) {
  if (!task.context || task.context.length === 0) return '（无上下文）';

  const lastEntry = task.context[task.context.length - 1];
  if (lastEntry.type === 'input') return '（初始输入，暂无执行结果）';

  const summary = lastEntry.output?.summary;
  if (summary) return summary;
  if (lastEntry.output?.files?.length) return `[文件] ${lastEntry.output.files.join(', ')}`;
  return '（无摘要）';
}
