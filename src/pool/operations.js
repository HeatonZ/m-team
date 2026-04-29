/**
 * M-Team 任务池 — 内部写操作（需要事务的操作）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  openDb,
  getDb,
  getTaskRow,
  updateTaskRow,
  insertTask,
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

function init() {
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  openDb(DB_PATH);
}

// ============================================================
// 写操作
// ============================================================

/**
 * 发布任务
 * @returns {string} taskId
 */
export function publishTask({ description, goal, input = {}, publisher = 'user', priority }) {
  init();

  const task = createTask({ description, goal, input, publisher, priority });

  const db = getDb();
  db.transaction(() => {
    insertTask(task);
    syncTaskJson(task);
  })();

  console.log(`[m-team-pool] 任务发布: ${task.taskId} - ${description}`);
  return task.taskId;
}

/**
 * 认领任务
 * @returns {{ success: boolean, taskId: string, task?: object, reason?: string }}
 */
export function claimTask(taskId, agentId) {
  init();

  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, taskId, reason: 'TASK_NOT_FOUND' };
    if (task.status !== TaskStatus.PENDING) return { success: false, taskId, reason: 'NOT_PENDING' };

    // relay：上一个 executor 成为 lastExecutor
    const newLastExecutor = task.executor !== null ? task.executor : task.lastExecutor;

    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, last_heartbeat_at = ? WHERE task_id = ? AND status = ?'
    ).run(TaskStatus.RUNNING, agentId, newLastExecutor, Date.now(), taskId, TaskStatus.PENDING);

    if (updated.changes === 0) {
      return { success: false, taskId, reason: 'ALREADY_CLAIMED' };
    }

    const updatedTask = getTaskRow(taskId);
    syncTaskJson(updatedTask);

    console.log(`[m-team-pool] ${agentId} 认领了任务 ${taskId}`);
    return { success: true, taskId, task: updatedTask };
  })();
}

/**
 * 更新任务（状态 / context / description / heartbeat）
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

    // relay：重新放回 pending 时，清空 executor，记录 lastExecutor
    if (status === TaskStatus.PENDING) {
      const patch = {
        status: TaskStatus.PENDING,
        executor: null,
        lastExecutor: task.executor ?? null,
        description: description ?? task.description,
        lastHeartbeatAt: lastHeartbeatAt ?? null
      };

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

    // 追加 context 步骤
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

    console.log(`[m-team-pool] 任务 ${taskId} 状态: ${status}`);
    return updated;
  })();
}

/**
 * Publisher 取消任务（不可再 relay）
 * @returns {{ success: boolean, task?: object, reason?: string }}
 */
export function cancelTask(taskId, publisher, reason) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.publisher !== publisher) return { success: false, task, reason: 'NOT_PUBLISHER' };
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      return { success: false, task, reason: 'ALREADY_TERMINAL' };
    }

    const patch = {
      status: TaskStatus.CANCELLED,
      executor: null,
      completedAt: Date.now()
    };

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-pool] 任务 ${taskId} 被 ${publisher} 取消: ${reason ?? '无原因'}`);
    return { success: true, task: updated };
  })();
}

/**
 * Executor 主动放弃当前任务（放回 pending）
 * @returns {{ success: boolean, task?: object, reason?: string }}
 */
export function relinquishTask(taskId, executorId) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, task: null, reason: 'TASK_NOT_FOUND' };
    if (task.executor !== executorId) return { success: false, task, reason: 'NOT_CURRENT_EXECUTOR' };
    if (task.status === TaskStatus.CANCELLED) return { success: false, task, reason: 'TASK_CANCELLED' };

    const patch = {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId
    };

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-pool] executor ${executorId} 放弃任务 ${taskId}`);
    return { success: true, task: updated };
  })();
}

/**
 * subagent_ended hook 调用：executor 正常结束
 * @returns {{ success: boolean, task?: object, reason?: string }}
 */
export function completeTask(taskId, contextEntry = null) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };

    // relay 后旧 session 结束时任务已非 running，直接跳过
    if (task.status !== TaskStatus.RUNNING) {
      return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
    }

    const patch = { status: TaskStatus.COMPLETED, completedAt: Date.now() };

    if (contextEntry) {
      const newContext = [...task.context];
      newContext.push({
        executor: task.executor || 'unknown',
        step: contextEntry.step,
        output: contextEntry.output || {},
        completedAt: Date.now()
      });
      patch.context = JSON.stringify(newContext);
    }

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-pool] 任务 ${taskId} 完成（subagent_ended hook）`);
    return { success: true, task: updated };
  })();
}

/**
 * subagent_ended hook 调用：executor 异常结束
 * @returns {{ success: boolean, task?: object, reason?: string }}
 */
export function failTask(taskId, errorMsg = null, contextEntry = null) {
  init();
  const db = getDb();

  return db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };

    // relay 后旧 session 结束时任务已非 running，直接跳过
    if (task.status !== TaskStatus.RUNNING) {
      return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
    }

    const patch = { status: TaskStatus.FAILED, completedAt: Date.now() };

    if (contextEntry) {
      const newContext = [...task.context];
      newContext.push({
        executor: task.executor || 'unknown',
        step: contextEntry.step,
        output: contextEntry.output || {},
        completedAt: Date.now()
      });
      patch.context = JSON.stringify(newContext);
    }

    updateTaskRow(taskId, patch);
    const updated = getTaskRow(taskId);
    syncTaskJson(updated);

    console.log(`[m-team-pool] 任务 ${taskId} 失败（subagent_ended hook）: ${errorMsg ?? ''}`);
    return { success: true, task: updated };
  })();
}
