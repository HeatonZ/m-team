/**
 * M-Team Queue — 去中心化任务池（SQLite 版）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  openDb,
  getDb,
  closeDb,
  getTaskRow,
  getAllTaskRows,
  getTaskRowsByStatus,
  getTaskRowByExecutor,
  insertTask,
  updateTaskRow,
  deleteTaskRow
} from './db.js';
import {
  TaskStatus,
  createTask,
  ensureTaskWorkspace,
  setWorkspaceRoot as setSchemaWorkspaceRoot
} from '../schema/task.js';

let WORKSPACE_ROOT = '/mnt/d/code/m-team';
let DB_PATH = null;

export function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = root;
  DB_PATH = path.join(root, 'queue', 'm-team.db');
  setSchemaWorkspaceRoot(path.join(root, 'tasks'));
}

function getTasksDir() {
  return path.join(WORKSPACE_ROOT, 'tasks');
}

function getTaskPath(taskId) {
  return path.join(ensureTaskWorkspace(taskId), 'task.json');
}

/** 同步 task.json 代理文件（供 agents 直接读文件系统） */
function syncTaskJson(task) {
  const p = getTaskPath(task.taskId);
  fs.writeFileSync(p, JSON.stringify(task, null, 2), 'utf8');
}

// ============================================================
// init
// ============================================================

function init() {
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  openDb(DB_PATH);
}

// ============================================================
// operations
// ============================================================

export function publishTask({ description, goal, input = {}, publisher = 'user', priority }) {
  init();

  const task = createTask({ description, goal, input, publisher, priority });

  const db = getDb();
  db.transaction(() => {
    insertTask(task);
    syncTaskJson(task);
  })();

  console.log(`[m-team-queue] 任务发布: ${task.taskId} - ${description}`);
  return task.taskId;
}

export function claimTask(taskId, agentId) {
  init();

  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return false;
    if (task.status !== TaskStatus.PENDING) return false;

    // relay：上一个 executor 成为 lastExecutor
    // claim 后设置 lastExecutor，只在有当前 executor 时才更新（不覆盖 relay 遗留的 lastExecutor）
    const newLastExecutor = task.executor !== null ? task.executor : task.lastExecutor;

    const patch = {
      status: TaskStatus.RUNNING,
      executor: agentId,
      lastExecutor: newLastExecutor,
      lastHeartbeatAt: Date.now()
    };

    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, last_heartbeat_at = ? WHERE task_id = ? AND status = ?'
    ).run(patch.status, patch.executor, patch.lastExecutor, patch.lastHeartbeatAt, taskId, TaskStatus.PENDING);

    if (updated.changes === 0) return false; // 已被他人抢走

    const updatedTask = getTaskRow(taskId);
    syncTaskJson(updatedTask);

    console.log(`[m-team-queue] ${agentId} 认领了任务 ${taskId}`);
    return true;
  })();
}

export function getPendingTasks(agentId = null) {
  init();

  if (agentId && getAgentActiveTask(agentId)) return [];

  const rows = getTaskRowsByStatus(TaskStatus.PENDING);
  return rows;
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

/**
 * @param {string} taskId
 * @param {string|null} status
 * @param {Object|null} contextEntry
 * @param {string|null} description
 * @param {number|null} lastHeartbeatAt
 * @param {string|null} executorId
 */
export function updateTask(taskId, status, contextEntry = null, description = null, lastHeartbeatAt = null, executorId = null) {
  init();

  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return null;

    // cancelled 任务：允许追加 context，允许完成/失败；拒绝 relay
    if (task.status === TaskStatus.CANCELLED) {
      if (status === TaskStatus.PENDING) {
        return { error: 'TASK_CANCELLED', task };
      }

      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        const patch = { status, completedAt: Date.now() };
        updateTaskRow(taskId, patch);
        const updated = getTaskRow(taskId);
        syncTaskJson(updated);
        return updated;
      }

      // 只追加 context 或心跳，保持 cancelled
      if (contextEntry) {
        const newContext = [...task.context];
        newContext.push({
          executor: executorId || task.executor || 'unknown',
          step: contextEntry.step,
          output: contextEntry.output || {},
          completedAt: Date.now()
        });
        updateTaskRow(taskId, { context: JSON.stringify(newContext) });
        const updated = getTaskRow(taskId);
        syncTaskJson(updated);
        return updated;
      }

      return task;
    }

    // 普通任务：原有逻辑
    // relay：重新放回 pending 时，清空 executor，记录 lastExecutor
    if (status === TaskStatus.PENDING) {
      const patch = {
        status: TaskStatus.PENDING,
        executor: null,
        lastExecutor: task.executor ?? null,
        description: description ?? task.description,
        lastHeartbeatAt: lastHeartbeatAt ?? null
      };

      // 追加 context 步骤
      if (contextEntry) {
        const newContext = [...task.context];
        newContext.push({
          executor: executorId || task.executor || 'unknown',
          step: contextEntry.step,
          output: contextEntry.output || {},
          completedAt: Date.now()
        });
        patch.context = JSON.stringify(newContext);
      }

      updateTaskRow(taskId, patch);
      const updated = getTaskRow(taskId);
      syncTaskJson(updated);
      return updated;
    }

    // 普通状态更新
    if (status) {
      const patch = { status };
      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        patch.completedAt = Date.now();
      }
      if (status === TaskStatus.RUNNING && !task.lastHeartbeatAt) {
        patch.lastHeartbeatAt = Date.now();
      }
      if (description) patch.description = description;
      if (lastHeartbeatAt) patch.lastHeartbeatAt = lastHeartbeatAt;

      updateTaskRow(taskId, patch);
    } else {
      // 只更新心跳
      if (lastHeartbeatAt) {
        updateTaskRow(taskId, { lastHeartbeatAt });
      }
      if (description) {
        updateTaskRow(taskId, { description });
      }
    }

    // 追加 context 步骤（任何状态都可能需要追加 context）
    if (contextEntry) {
      const current = getTaskRow(taskId);
      const newContext = [...current.context];
      newContext.push({
        executor: executorId || current.executor || 'unknown',
        step: contextEntry.step,
        output: contextEntry.output || {},
        completedAt: Date.now()
      });
      updateTaskRow(taskId, { context: JSON.stringify(newContext) });
    }

    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-queue] 任务 ${taskId} 状态: ${status}`);
    return updated;
  })();
}

/**
 * publisher 取消任务（不可再 relay）
 * @param {string} taskId
 * @param {string} publisher
 * @param {string} [reason]
 * @returns {{ success: boolean, task: object|null, reason?: string }}
 */
export function cancelTask(taskId, publisher, reason) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };

    // 只有 publisher 才能取消
    if (task.publisher !== publisher) {
      return { success: false, task, reason: 'NOT_PUBLISHER' };
    }

    // 终态任务不可取消
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return { success: false, task, reason: 'ALREADY_TERMINAL' };
    }

    const patch = {
      status: TaskStatus.CANCELLED,
      completedAt: Date.now()
    };

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-queue] 任务 ${taskId} 被 ${publisher} 取消: ${reason ?? '无原因'}`);
    return { success: true, task: updated };
  })();
}

/**
 * executor 主动放弃当前任务（放回 pending）
 * @param {string} taskId
 * @param {string} executorId
 * @returns {{ success: boolean, task: object|null, reason?: string }}
 */
export function relinquishTask(taskId, executorId) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };

    // 只有当前 executor 才能放弃
    if (task.executor !== executorId) {
      return { success: false, task, reason: 'NOT_CURRENT_EXECUTOR' };
    }

    // cancelled 任务不能 relinquish
    if (task.status === TaskStatus.CANCELLED) {
      return { success: false, task, reason: 'TASK_CANCELLED' };
    }

    const patch = {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId
    };

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-queue] executor ${executorId} 放弃任务 ${taskId}`);
    return { success: true, task: updated };
  })();
}
