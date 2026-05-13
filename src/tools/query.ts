/**
 * Read-only query tools.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, readTaskId } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks, getTaskRowsByStatus } from '../pool/index.js';
import { buildExecutorTaskView, buildExecutorTaskViewList, formatTaskAsText, formatTaskLine, formatTaskListAsText } from './helpers.js';
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
    label: 'Get pending tasks',
    description: 'List pending tasks that can be claimed by the current agent',
    parameters: GetPendingParams,
    async execute(_toolCallId: string, rawParams: GetPendingParamsInterface) {
      const { agentId } = rawParams;
      const pending = getPendingTasks(agentId);
      const sanitized = buildExecutorTaskViewList(pending);

      if (sanitized.length === 0) {
        return textResult('No claimable tasks', { pending: [] });
      }

      const lines = pending.map((task, i) => formatTaskLine(task, i + 1));
      const text = `Pending tasks: ${sanitized.length}\n${lines.join('\n')}\n\nChoose by taskType and current step, then call mteam_claim_task(taskId=...)`;

      return {
        content: [{ type: 'text' as const, text }],
        details: { success: true, pending: sanitized },
      };
    },
  });
}

export function registerGetAgentActive(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_agent_active');
  api.registerTool({
    name: 'mteam_get_agent_active',
    label: 'Get active task',
    description: 'Show the running task for the current agent',
    parameters: GetAgentActiveParams,
    async execute(_toolCallId: string, rawParams: GetAgentActiveParamsInterface) {
      const { agentId } = rawParams;
      const activeTask = getAgentActiveTask(agentId);
      if (!activeTask) {
        return textResult(`agent ${agentId} has no running task`, { activeTask: null });
      }
      return textResult(formatTaskAsText(activeTask), { activeTask: buildExecutorTaskView(activeTask) });
    },
  });
}

export function registerGetTask(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_task');
  api.registerTool({
    name: 'mteam_get_task',
    label: 'Get task detail',
    description: 'Show executor-safe task view: current step and recent context only',
    parameters: GetTaskParams,
    async execute(_toolCallId: string, rawParams: GetTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const task = getTask(taskId);
      if (!task) {
        return textResult(`Task ${taskId} not found`, { task: null });
      }
      return textResult(formatTaskAsText(task), { task: buildExecutorTaskView(task) });
    },
  });
}

export function registerGetAllTasks(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_all_tasks');
  api.registerTool({
    name: 'mteam_get_all_tasks',
    label: 'Get all tasks',
    description: 'List all tasks, optionally filtered by status',
    parameters: GetAllTasksParams,
    async execute(_toolCallId: string, rawParams: GetAllTasksParamsInterface) {
      const { status } = rawParams;
      const tasks = status ? getTaskRowsByStatus(status) : getAllTasks();

      if (tasks.length === 0) {
        return textResult(status ? `No tasks with status ${status}` : 'No tasks', { tasks: [] });
      }

      const label = status ? `${status} tasks` : 'All tasks';
      return textResult(formatTaskListAsText(tasks, label), { tasks: buildExecutorTaskViewList(tasks) });
    },
  });
}
