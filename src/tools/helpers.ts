/**
 * 任务数据脱敏工具
 *
 * 原则：
 * - goal 是复盘标尺，只在任务结束时由 publisher 验收时使用
 * - 认领和查询接口不能暴露 goal 给执行者
 */

import type { Task } from '../schema/task.js';
import { PRIORITY_LABELS } from '../schema/task.js';

/**
 * 从 Task 对象中移除 goal 字段，返回安全的展示用对象
 */
export function sanitizeTask(task: Task): Omit<Task, 'goal'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { goal: _goal, ...sanitized } = task;
  return sanitized;
}

/** Task[] 的批量脱敏 */
export function sanitizeTaskList(tasks: Task[]): Array<Omit<Task, 'goal'>> {
  return tasks.map(sanitizeTask);
}

/**
 * 将任务格式化为一行摘要，供 LLM 在列表中快速浏览
 * 仅包含：优先级、taskId、description（不含 goal）
 */
export function formatTaskLine(task: Omit<Task, 'goal'>, index: number): string {
  const priority = PRIORITY_LABELS[task.priority] ?? '🟡 中';
  const stepCount = task.context.length - 1;
  return `${index}. [${priority}] ${task.taskId} — ${task.description}${stepCount > 0 ? ` (已${stepCount}步)` : ''}`;
}
