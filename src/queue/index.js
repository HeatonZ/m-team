/**
 * M-Team Queue — 去中心化任务池
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  TaskStatus,
  createTask,
  getTaskWorkspace,
  ensureTaskWorkspace,
  setWorkspaceRoot as setSchemaWorkspaceRoot
} from '../schema/task.js';

let WORKSPACE_ROOT = '/mnt/d/code/m-team';

export function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = root;
  setSchemaWorkspaceRoot(path.join(root, 'tasks'));
}

function getTasksDir() {
  return path.join(WORKSPACE_ROOT, 'tasks');
}

function getQueueDir() {
  return path.join(WORKSPACE_ROOT, 'queue');
}

function getTasksIndexPath() {
  return path.join(getQueueDir(), 'tasks.json');
}

function init() {
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(getQueueDir(), { recursive: true });

  const indexPath = getTasksIndexPath();
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify({ tasks: [], version: 1 }, null, 2), 'utf8');
  }
}

export function publishTask({ description, goal, input = {}, publisher = 'user', priority }) {
  init();

  const task = createTask({ description, goal, input, publisher, priority });
  const taskDir = ensureTaskWorkspace(task.taskId);

  const taskPath = path.join(taskDir, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');

  const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
  index.tasks.push(task.taskId);
  fs.writeFileSync(getTasksIndexPath(), JSON.stringify(index, null, 2), 'utf8');

  console.log(`[m-team-queue] 任务发布: ${task.taskId} - ${description}`);
  return task.taskId;
}

export function claimTask(taskId, agentId) {
  const taskDir = getTaskWorkspace(taskId);
  const taskPath = path.join(taskDir, 'task.json');
  const lockPath = path.join(taskDir, '.lock');

  if (!fs.existsSync(taskPath)) return false;

  try {
    fs.writeFileSync(lockPath, agentId, { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }

  try {
    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));

    if (task.status !== TaskStatus.PENDING) return false;

    // 接力：上一个执行者成为 lastExecutor
    if (task.executor) {
      task.lastExecutor = task.executor;
    }

    task.status = TaskStatus.CLAIMED;
    task.executor = agentId;
    task.claimedAt = Date.now();
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');

    console.log(`[m-team-queue] ${agentId} 认领了任务 ${taskId}`);
    return true;
  } finally {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

export function getPendingTasks(agentId = null) {
  init();
  const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));

  if (agentId && getAgentActiveTask(agentId)) return [];

  const pending = [];
  for (const tid of index.tasks) {
    const taskPath = path.join(getTaskWorkspace(tid), 'task.json');
    if (!fs.existsSync(taskPath)) continue;

    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    if (task.status !== TaskStatus.PENDING) continue;

    pending.push(task);
  }

  const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
  return pending.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });
}

export function getAgentActiveTask(agentId) {
  const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));

  for (const tid of index.tasks) {
    const taskPath = path.join(getTaskWorkspace(tid), 'task.json');
    if (!fs.existsSync(taskPath)) continue;

    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    if (task.executor === agentId && (task.status === TaskStatus.CLAIMED || task.status === TaskStatus.RUNNING)) {
      return task;
    }
  }
  return null;
}

/**
 * 更新任务状态，或追加 context 步骤
 * @param {string} taskId
 * @param {string|null} status
 * @param {Object|null} contextEntry - 追加到 context 的步骤，格式 { executor, step, output }
 * @param {string|null} description - 更新当前步骤描述
 * @param {number|null} lastHeartbeatAt
 */
export function updateTask(taskId, status, contextEntry = null, description = null, lastHeartbeatAt = null) {
  const taskPath = path.join(getTaskWorkspace(taskId), 'task.json');
  if (!fs.existsSync(taskPath)) return null;

  const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));

  // 接力：任务重新放回 pending 时，保留 lastExecutor
  if (status === TaskStatus.PENDING) {
    if (task.executor) {
      task.lastExecutor = task.executor;
      task.executor = null;
    }
  }

  if (status) task.status = status;
  if (description) task.description = description;
  if (lastHeartbeatAt) task.lastHeartbeatAt = lastHeartbeatAt;

  // 追加步骤到 context
  if (contextEntry) {
    task.context.push({
      executor: contextEntry.executor,
      step: contextEntry.step,
      output: contextEntry.output || {},
      completedAt: Date.now()
    });
  }

  if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
    task.completedAt = Date.now();
  }
  if (status === TaskStatus.RUNNING && !task.lastHeartbeatAt) {
    task.lastHeartbeatAt = Date.now();
  }

  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
  console.log(`[m-team-queue] 任务 ${taskId} 状态: ${status}`);
  return task;
}

export function getTask(taskId) {
  const taskPath = path.join(getTaskWorkspace(taskId), 'task.json');
  if (!fs.existsSync(taskPath)) return null;
  return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
}

export function getAllTasks() {
  init();
  const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
  const tasks = [];

  for (const tid of index.tasks) {
    const task = getTask(tid);
    if (task) tasks.push(task);
  }

  return tasks.sort((a, b) => b.createdAt - b.createdAt);
}

export function getTasksByExecutor(agentId) {
  return getAllTasks().filter(t => t.executor === agentId);
}
