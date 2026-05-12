/**
 * DB row ? task conversions.
 */

import {
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  normalizeTask,
} from './task.js';

export interface TaskRow {
  task_id: string;
  task_type: string;
  description: string;
  goal: string;
  step_contract: string | null;
  context: string;
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

export function serializeTask(input: Task): TaskRow {
  const task = normalizeTask(input);
  return {
    task_id: task.taskId,
    task_type: task.taskType,
    description: task.description,
    goal: task.goal,
    step_contract: task.stepContract ? JSON.stringify(task.stepContract) : null,
    context: JSON.stringify(task.context),
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

export function deserializeTask(row: TaskRow): Task {
  return normalizeTask({
    taskId: row.task_id,
    taskType: (row.task_type ?? 'general') as TaskType,
    description: row.description,
    goal: row.goal,
    ...(row.step_contract ? { stepContract: JSON.parse(row.step_contract) } : {}),
    context: JSON.parse(row.context),
    priority: row.priority as TaskPriority,
    publisher: row.publisher,
    status: row.status as TaskStatus,
    executor: row.executor,
    lastExecutor: row.last_executor,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  });
}
