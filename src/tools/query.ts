/**
 * 查询类工具：get_pending / get_agent_active / get_task / get_all_tasks
 * 共同特点：只读，不修改状态，不需要通知
 *
 * 重要：LLM 读 content.text 判断结果，不读 details。
 * 所有 execute 必须把任务数据嵌入 content.text，details 只做结构化数据补充。
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks } from '../pool/index.js';
import { sanitizeTask, sanitizeTaskList } from './helpers.js';
import type { Task } from '../schema/task.js';
import type { ContextStepEntry } from '../schema/task.js';

/**
 * 把任务格式化为可读文本，嵌入 content.text 供 LLM 读取。
 * 任务关键信息全部内嵌，details 只做辅助。
 */
function formatTaskForLLM(task: Omit<Task, 'goal'>): string {
  const contextCount = task.context.filter((c) => c.type === 'step').length;
  const lastStep = task.context[task.context.length - 1] as ContextStepEntry | undefined;
  const lastSummary = lastStep?.output?.summary ?? '(无)';

  return [
    `任务ID: ${task.taskId}`,
    `优先级: ${task.priority}`,
    `发布时间: ${new Date(task.createdAt).toLocaleString('zh-CN')}`,
    `当前状态: ${task.status}`,
    `已执行步骤: ${contextCount}步`,
    `最新步骤: ${lastSummary}`,
    `任务描述: ${task.description}`,
  ].join('\n');
}

function formatPendingTasksForLLM(tasks: Omit<Task, 'goal'>[]): string {
  if (tasks.length === 0) {
    return '暂无待认领任务';
  }
  return tasks.map((t, i) => `【${i + 1}】\n${formatTaskForLLM(t)}`).join('\n\n');
}

export function registerGetPending(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void } | null }
): void {
  api.logger?.info('[m-team] registering mteam_get_pending');
  api.registerTool({
    name: 'mteam_get_pending',
    description: '获取 agent 的待认领任务列表（该 agent 有进行中任务时返回空）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' },
      },
      required: ['agentId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
      const pending = getPendingTasks(agentId);
      // 认领时只看 description，goal 不暴露给执行者
      const sanitized = pending.map(({ goal: _goal, ...rest }) => rest);

      const contentText = sanitized.length === 0
        ? '获取待认领任务成功。\n\n暂无待认领任务'
        : `获取待认领任务成功，共 ${sanitized.length} 个任务：\n\n${formatPendingTasksForLLM(sanitized as Omit<Task, 'goal'>[])}`;

      return textResult(contentText, { pending: sanitized });
    },
  });
}

export function registerGetAgentActive(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void } | null }
): void {
  api.logger?.info('[m-team] registering mteam_get_agent_active');
  api.registerTool({
    name: 'mteam_get_agent_active',
    description: '获取 agent 当前进行中的任务（一个 agent 不能同时做多个任务）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' },
      },
      required: ['agentId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
      const activeTask = getAgentActiveTask(agentId);
      const sanitized = activeTask ? sanitizeTask(activeTask) : null;

      const contentText = sanitized === null
        ? '获取进行中任务成功。\n\n该 agent 当前没有进行中的任务'
        : `获取进行中任务成功：\n\n${formatTaskForLLM(sanitized as Omit<Task, 'goal'>)}`;

      return textResult(contentText, { activeTask: sanitized });
    },
  });
}

export function registerGetTask(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void } | null }
): void {
  api.logger?.info('[m-team] registering mteam_get_task');
  api.registerTool({
    name: 'mteam_get_task',
    description: '获取任务详情',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
      },
      required: ['taskId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
      const task = getTask(taskId);
      const sanitized = task ? sanitizeTask(task) : null;

      const contentText = sanitized === null
        ? `获取任务详情成功。\n\n未找到任务 ${taskId}`
        : `获取任务详情成功：\n\n${formatTaskForLLM(sanitized as Omit<Task, 'goal'>)}`;

      return textResult(contentText, { task: sanitized });
    },
  });
}

export function registerGetAllTasks(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void } | null }
): void {
  api.logger?.info('[m-team] registering mteam_get_all_tasks');
  api.registerTool({
    name: 'mteam_get_all_tasks',
    description: '获取所有任务',
    parameters: { type: 'object', properties: {} } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string) {
      const tasks = getAllTasks();
      const sanitized = sanitizeTaskList(tasks);

      const contentText = sanitized.length === 0
        ? '获取所有任务成功。\n\n暂无任何任务'
        : `获取所有任务成功，共 ${sanitized.length} 个任务：\n\n${formatPendingTasksForLLM(sanitized as Omit<Task, 'goal'>[])}`;

      return textResult(contentText, { tasks: sanitized });
    },
  });
}
