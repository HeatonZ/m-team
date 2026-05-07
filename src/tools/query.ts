/**
 * 查询类工具：get_pending / get_agent_active / get_task / get_all_tasks
 * 共同特点：只读，不修改状态，不需要通知
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks } from '../pool/index.js';
import { sanitizeTask, sanitizeTaskList, formatTaskLine } from './helpers.js';

export function registerGetPending(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_pending');
  api.registerTool({
    name: 'mteam_get_pending',
    label: '获取待认领',
    description: '获取 agent 的待认领任务列表（该 agent 有进行中任务时返回空）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' },
      },
      required: ['agentId'],
    },
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
      const pending = getPendingTasks(agentId);
      const sanitized = pending.map(sanitizeTask);

      if (sanitized.length === 0) {
        return textResult('暂无待认领任务', { pending: [] });
      }

      const lines = sanitized.map((t, i) => formatTaskLine(t, i + 1));
      const text = `待认领任务 ${sanitized.length} 个：\n${lines.join('\n')}\n\n如需认领，用 mteam_claim_task(taskId=...)`;

      return { content: [{ type: 'text' as const, text }], details: { success: true, pending: sanitized } };
    },
  });
}

export function registerGetAgentActive(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_agent_active');
  api.registerTool({
    name: 'mteam_get_agent_active',
    label: '获取进行中',
    description: '获取 agent 当前进行中的任务（一个 agent 不能同时做多个任务）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' },
      },
      required: ['agentId'],
    },
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
      const activeTask = getAgentActiveTask(agentId);
      return textResult('获取进行中任务成功', { activeTask: activeTask ? sanitizeTask(activeTask) : null });
    },
  });
}

export function registerGetTask(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_task');
  api.registerTool({
    name: 'mteam_get_task',
    label: '获取任务详情',
    description: '获取任务详情',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
      },
      required: ['taskId'],
    },
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
      const task = getTask(taskId);
      return textResult('获取任务详情成功', { task: task ? sanitizeTask(task) : null });
    },
  });
}

export function registerGetAllTasks(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_all_tasks');
  api.registerTool({
    name: 'mteam_get_all_tasks',
    label: '获取所有任务',
    description: '获取所有任务',
    parameters: { type: 'object', properties: {} },
    async execute(_toolCallId: string) {
      const tasks = getAllTasks();
      return textResult('获取所有任务成功', { tasks: sanitizeTaskList(tasks) });
    },
  });
}
