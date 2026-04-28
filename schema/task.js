/**
 * M-Team Task Schema — 固定任务格式规范
 * 
 * 任务结构是固定的，不可配置。
 * 可配置的只有路径（workspaceRoot、queueDir）。
 */

const fs = require('fs');
const path = require('path');

// 任务目录根路径（可配置）
let WORKSPACE_ROOT = '/mnt/d/code/m-team/workspace';

/**
 * 设置工作目录根路径
 * @param {string} rootPath
 */
function setWorkspaceRoot(rootPath) {
  WORKSPACE_ROOT = rootPath;
}

/**
 * 获取工作目录根路径
 */
function getWorkspaceRoot() {
  return WORKSPACE_ROOT;
}

/**
 * 获取任务的工作目录
 * @param {string} taskId
 * @returns {string}
 */
function getTaskWorkspace(taskId) {
  return path.join(WORKSPACE_ROOT, taskId);
}

/**
 * 确保任务目录存在
 * @param {string} taskId
 * @returns {string} 任务目录路径
 */
function ensureTaskWorkspace(taskId) {
  const ws = getTaskWorkspace(taskId);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

// ============================================================
// 固定任务格式（不可修改）
// ============================================================

// 任务状态枚举
const TaskStatus = {
  PENDING: 'pending',     // 待认领
  CLAIMED: 'claimed',    // 已认领（有owner）
  RUNNING: 'running',    // 执行中
  COMPLETED: 'completed',  // 完成
  FAILED: 'failed'       // 失败
};

// 能力标签 → agent 映射（固定映射表）
const CapabilityAgent = {
  captain: 'captain',
  maker: 'maker',
  scholar: 'scholar',
  general: null  // 任意 agent 都能认领
};

// 任务优先级枚举
const TaskPriority = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
};

// 有效能力标签列表
const VALID_CAPABILITIES = ['captain', 'maker', 'scholar', 'general'];

// 有效优先级列表
const VALID_PRIORITIES = ['high', 'normal', 'low'];

/**
 * 标准任务结构（固定格式，不可修改）
 * 
 * @typedef {Object} Task
 * @property {string} taskId - 任务ID，格式: task_{timestamp}_{random6}
 * @property {string} description - 任务描述
 * @property {Object} input - 任务输入参数
 * @property {string} initiator - 发起者: ceo/manager/agentId
 * @property {string} status - 状态: pending/claimed/running/completed/failed
 * @property {string|null} owner - 认领者agentId
 * @property {number} createdAt - 创建时间戳
 * @property {number|null} claimedAt - 认领时间戳
 * @property {number|null} completedAt - 完成时间戳
 * @property {number|null} lastHeartbeatAt - 最后心跳时间戳（running 时由 agent 定期更新）
 * @property {string|null} summary - 结果摘要（不超过200字）
 * @property {Object|null} result - 完整结果数据
 * @property {string} priority - 优先级: high/normal/low，默认 normal
 */

/**
 * 验证任务对象是否符合固定格式
 * @param {object} task
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateTask(task) {
  const errors = [];
  
  if (!task.taskId || !task.taskId.startsWith('task_')) {
    errors.push('taskId 格式无效，应为 task_{timestamp}_{random}');
  }
  if (!task.description || typeof task.description !== 'string') {
    errors.push('description 必填且为字符串');
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
 * 创建标准任务（工厂方法）
 * @param {object} params
 * @returns {Task}
 */
function createTask({ description, input = {}, initiator = 'ceo', priority = TaskPriority.NORMAL }) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  return {
    taskId,
    description: String(description),
    input: input || {},
    priority,
    initiator: initiator || 'ceo',
    status: TaskStatus.PENDING,
    owner: null,
    createdAt: Date.now(),
    claimedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    summary: null,
    result: null
  };
}

/**
 * 获取任务状态标签（人类可读）
 */
function getStatusLabel(status) {
  const labels = {
    pending: '⏳ 待认领',
    claimed: '🔄 已认领',
    running: '⚙️ 执行中',
    completed: '✅ 完成',
    failed: '❌ 失败'
  };
  return labels[status] || status;
}

/**
 * 格式化任务为人类可读字符串
 */
function formatTaskForHuman(task) {
  const priorityLabel = { high: '🔴 高', normal: '🟡 中', low: '🟢 低' };
  const lines = [
    `📋 ${task.description}`,
    `ID: ${task.taskId}`,
    `优先级: ${priorityLabel[task.priority] || '🟡 中'}`,
    `状态: ${getStatusLabel(task.status)}`
  ];
  if (task.owner) lines.push(`执行者: ${task.owner}`);
  if (task.summary) lines.push(`摘要: ${task.summary}`);
  
  return lines.join('\n');
}

/**
 * 获取任务的标准摘要（用于传递给下一个节点）
 * @param {Task} task
 * @returns {string} 不超过200字的摘要
 */
function getTaskSummary(task) {
  if (task.summary) return task.summary;
  if (!task.result) return '（无结果）';
  
  // result 是对象时，转为简短描述
  if (typeof task.result === 'object') {
    const keys = Object.keys(task.result);
    if (keys.length <= 3) {
      return keys.map(k => `${k}: ${JSON.stringify(task.result[k])}`).join(', ');
    }
    return `结果包含 ${keys.length} 个字段: ${keys.slice(0, 3).join(', ')}...`;
  }
  return String(task.result).substring(0, 200);
}

module.exports = {
  // 固定常量（不可修改）
  TaskStatus,
  TaskPriority,
  VALID_CAPABILITIES,
  VALID_PRIORITIES,
  
  // 配置函数
  setWorkspaceRoot,
  getWorkspaceRoot,
  getTaskWorkspace,
  ensureTaskWorkspace,
  
  // 工具函数
  validateTask,
  createTask,
  formatTaskForHuman,
  getStatusLabel,
  getTaskSummary
};