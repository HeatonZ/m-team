/**
 * 任务数据脱敏工具
 *
 * 原则：
 * - goal 是复盘标尺，只在任务结束时由 publisher 验收时使用
 * - 认领和查询接口不能暴露 goal 给执行者
 */

import type { Task } from '../schema/task.js';
import { PRIORITY_LABELS, TASK_TYPE_LABELS, getStatusLabel } from '../schema/task.js';

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
  const taskType = TASK_TYPE_LABELS[task.taskType] ?? task.taskType;
  return `${index}. [${priority}] [${taskType}] ${task.taskId} — ${task.description}${stepCount > 0 ? ` (已${stepCount}步)` : ''}`;
}

// ============================================================
// text 内容格式化（OpenClaw agent 只看 content[].text，不看 details）
// ============================================================

/**
 * 单个任务 → 文本（默认隐藏 goal，供执行路径工具使用）
 * 用于 mteam_get_task / mteam_get_agent_active / mteam_claim_task 等执行路径返回
 */
export function formatTaskAsText(task: Task, options?: { includeGoal?: boolean }): string {
  const status = getStatusLabel(task.status);
  const priority = PRIORITY_LABELS[task.priority] ?? '🟡 中';
  const stepCount = task.context.filter(e => e.type === 'step').length;
  const includeGoal = options?.includeGoal ?? false;

  const lines = [
    `📋 任务详情`,
    `ID: ${task.taskId}`,
    `类型: ${TASK_TYPE_LABELS[task.taskType] ?? task.taskType}`,
    `状态: ${status}`,
    `优先级: ${priority}`,
  ];
  if (includeGoal) lines.push(`目标: ${task.goal}`);
  lines.push(`当前步骤: ${task.description}`);
  lines.push(`发布者: ${task.publisher}`);
  if (task.executor) lines.push(`执行者: ${task.executor}`);
  if (task.lastExecutor) lines.push(`上一步: ${task.lastExecutor}`);
  lines.push(`已执行步骤: ${stepCount}`);
  lines.push(`创建时间: ${new Date(task.createdAt).toISOString()}`);

  // 完整执行历史（含每步结果）
  if (task.context.length > 0) {
    const steps = task.context.filter(e => e.type === 'step');
    if (steps.length > 0) {
      lines.push(`\n【执行历史】共 ${steps.length} 步`);
      steps.forEach((entry, idx) => {
        const step = entry as { type: 'step'; executor: string; step: string; output?: { summary?: string; files?: string[]; error?: string } };
        lines.push(`\n步骤${idx + 1} [${step.executor}]: ${step.step}`);
        if (step.output?.summary) lines.push(`  结果: ${step.output.summary}`);
        if (step.output?.error) lines.push(`  错误: ${step.output.error}`);
        if (step.output?.files?.length) lines.push(`  文件: ${step.output.files.join(', ')}`);
      });
    }
  }

  return lines.join('\n');
}

/**
 * 任务列表 → 文本
 * 用于 mteam_get_pending / mteam_get_all_tasks 等返回列表的工具
 */
export function formatTaskListAsText(tasks: Task[], label = '任务列表'): string {
  if (tasks.length === 0) return `📭 ${label}为空`;

  const lines = [`📋 ${label}（${tasks.length} 个）：`, ''];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const status = getStatusLabel(t.status);
    const priority = PRIORITY_LABELS[t.priority] ?? '🟡 中';
    const taskType = TASK_TYPE_LABELS[t.taskType] ?? t.taskType;
    lines.push(`${i + 1}. [${priority}] ${status} ${t.taskId}`);
    lines.push(`   🏷️ ${taskType}`);
    lines.push(`   📝 ${t.description}`);
    if (t.executor) lines.push(`   👤 执行者: ${t.executor}`);
    if (t.lastExecutor) lines.push(`   👤 上一步: ${t.lastExecutor}`);
    lines.push('');
  }

  return lines.join('\n');
}
