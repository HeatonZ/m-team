/**
 * 查询类工具：get_pending / get_agent_active / get_task / get_all_tasks
 * 共同特点：只读，不修改状态，不需要通知
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks } from '../pool/index.js';
import { sanitizeTask, sanitizeTaskList } from './helpers.js';

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
      return textResult('获取待认领任务成功', { pending: sanitized });
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
      return textResult('获取进行中任务成功', { activeTask: activeTask ? sanitizeTask(activeTask) : null });
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
      return textResult('获取任务详情成功', { task: task ? sanitizeTask(task) : null });
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
      return textResult('获取所有任务成功', { tasks: sanitizeTaskList(tasks) });
    },
  });
}
