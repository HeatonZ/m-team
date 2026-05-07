/**
 * 查询类工具：get_pending / get_agent_active / get_task / get_all_tasks
 * 共同特点：只读，不修改状态，不需要通知
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks, getTaskRowsByStatus } from '../pool/index.js';
import { sanitizeTask, sanitizeTaskList, formatTaskLine, formatTaskAsText, formatTaskListAsText } from './helpers.js';
import {
  GetPendingParams,
  GetAgentActiveParams,
  GetTaskParams,
  GetAllTasksParams,
} from '../types/tools.js';
import type {
  GetPendingParamsInterface,
  GetAgentActiveParamsInterface,
  GetTaskParamsInterface,
  GetAllTasksParamsInterface,
} from '../types/tools.js';

export function registerGetPending(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_pending');
  api.registerTool({
    name: 'mteam_get_pending',
    label: '获取待认领',
    description: '获取 agent 的待认领任务列表（该 agent 有进行中任务时返回空）',
    parameters: GetPendingParams,
    async execute(_toolCallId: string, rawParams: GetPendingParamsInterface) {
      const { agentId } = rawParams;
      const pending = getPendingTasks(agentId);
      const sanitized = pending.map(sanitizeTask);

      if (sanitized.length === 0) {
        return textResult('📭 暂无待认领任务', { pending: [] });
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
    parameters: GetAgentActiveParams,
    async execute(_toolCallId: string, rawParams: GetAgentActiveParamsInterface) {
      const { agentId } = rawParams;
      const activeTask = getAgentActiveTask(agentId);
      if (!activeTask) {
        return textResult(`agent ${agentId} 当前无进行中任务`, { activeTask: null });
      }
      return textResult(formatTaskAsText(activeTask), { activeTask: sanitizeTask(activeTask) });
    },
  });
}

export function registerGetTask(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_task');
  api.registerTool({
    name: 'mteam_get_task',
    label: '获取任务详情',
    description: '获取任务详情',
    parameters: GetTaskParams,
    async execute(_toolCallId: string, rawParams: GetTaskParamsInterface) {
      const { taskId } = rawParams;
      const task = getTask(taskId);
      if (!task) {
        return textResult(`任务 ${taskId} 不存在`, { task: null });
      }
      return textResult(formatTaskAsText(task), { task: sanitizeTask(task) });
    },
  });
}

export function registerGetAllTasks(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_all_tasks');
  api.registerTool({
    name: 'mteam_get_all_tasks',
    label: '获取所有任务',
    description: '获取所有任务，可按状态筛选',
    parameters: GetAllTasksParams,
    async execute(_toolCallId: string, rawParams: GetAllTasksParamsInterface) {
      const { status } = rawParams;
      const tasks = status
        ? getTaskRowsByStatus(status)
        : getAllTasks();

      if (tasks.length === 0) {
        return textResult(status ? `📭 无 ${status} 状态的任务` : '📭 任务池为空', { tasks: [] });
      }

      const label = status ? `${status} 任务` : '全部任务';
      return textResult(formatTaskListAsText(tasks, label), { tasks: sanitizeTaskList(tasks) });
    },
  });
}
