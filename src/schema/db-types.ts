/**
 * M-Team 数据库行类型
 *
 * SQLite 行使用 snake_case 列名，与内存中 Task 的 camelCase 对应。
 */

import {
  TaskPhase,
  type Task,
  type TaskLifecycle,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  createDefaultLifecycle,
  normalizeTask,
} from './task.js';

interface LegacyFlowState {
  ownerMode?: 'executor';
  phase?: 'direct' | 'collecting' | 'aggregating';
  retainOwner?: boolean;
}

// DB 行类型（snake_case）
export interface TaskRow {
  task_id: string;
  task_type: string;
  description: string;
  goal: string;
  context: string; // JSON string
  lifecycle: string | null;
  flow: string | null;
  priority: string;
  publisher: string;
  status: string;
  executor: string | null;
  last_executor: string | null;
  created_at: number;
  completed_at: number | null;
  updated_at: number;
}

function fromLegacyFlow(raw: string | null): TaskLifecycle {
  if (!raw) return createDefaultLifecycle();
  try {
    const flow = JSON.parse(raw) as LegacyFlowState;
    if (flow.phase === 'aggregating') return createDefaultLifecycle(TaskPhase.FINALIZING);
    if (flow.phase === 'collecting') return createDefaultLifecycle(TaskPhase.EXECUTING);
    return createDefaultLifecycle(TaskPhase.READY);
  } catch {
    return createDefaultLifecycle();
  }
}

// 序列化：Task → TaskRow（写入 DB）
export function serializeTask(input: Task): TaskRow {
  const task = normalizeTask(input);
  return {
    task_id: task.taskId,
    task_type: task.taskType,
    description: task.description,
    goal: task.goal,
    context: JSON.stringify(task.context),
    lifecycle: JSON.stringify(task.lifecycle),
    flow: null,
    priority: task.priority,
    publisher: task.publisher,
    status: task.status,
    executor: task.executor,
    last_executor: task.lastExecutor,
    created_at: task.createdAt,
    completed_at: task.completedAt ?? null,
    updated_at: task.updatedAt,
  };
}

// 反序列化：TaskRow → Task（从 DB 读出）
export function deserializeTask(row: TaskRow): Task {
  const lifecycle = (() => {
    if (row.lifecycle) {
      try {
        return JSON.parse(row.lifecycle) as TaskLifecycle;
      } catch {
        return fromLegacyFlow(row.flow);
      }
    }
    return fromLegacyFlow(row.flow);
  })();

  return normalizeTask({
    taskId: row.task_id,
    taskType: (row.task_type ?? 'general') as TaskType,
    description: row.description,
    goal: row.goal,
    context: JSON.parse(row.context),
    lifecycle,
    priority: row.priority as TaskPriority,
    publisher: row.publisher,
    status: row.status as TaskStatus,
    executor: row.executor,
    lastExecutor: row.last_executor,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  });
}
