/**
 * Read-only query tools.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
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
    label: '???????',
    description: '?? agent ???????????? agent ???????????',
    parameters: GetPendingParams,
    async execute(_toolCallId: string, rawParams: GetPendingParamsInterface) {
      const { agentId } = rawParams;
      const pending = getPendingTasks(agentId);
      const sanitized = buildExecutorTaskViewList(pending);

      if (sanitized.length === 0) {
        return textResult('???????', { pending: [] });
      }

      const lines = pending.map((t, i) => formatTaskLine({ ...t, context: t.context } as Omit<typeof t, 'goal'>, i + 1));
      const text = `????? ${sanitized.length} ??\n${lines.join('\n')}\n\n?? taskType??? current step??????? mteam_claim_task(taskId=...)`;

      return { content: [{ type: 'text' as const, text }], details: { success: true, pending: sanitized } };
    },
  });
}

export function registerGetAgentActive(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_agent_active');
  api.registerTool({
    name: 'mteam_get_agent_active',
    label: '???????',
    description: '?? agent ????????',
    parameters: GetAgentActiveParams,
    async execute(_toolCallId: string, rawParams: GetAgentActiveParamsInterface) {
      const { agentId } = rawParams;
      const activeTask = getAgentActiveTask(agentId);
      if (!activeTask) {
        return textResult(`agent ${agentId} ????????`, { activeTask: null });
      }
      return textResult(formatTaskAsText(activeTask), { activeTask: buildExecutorTaskView(activeTask) });
    },
  });
}

export function registerGetTask(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_task');
  api.registerTool({
    name: 'mteam_get_task',
    label: '??????',
    description: '???????executor ????????stepContract ?????????',
    parameters: GetTaskParams,
    async execute(_toolCallId: string, rawParams: GetTaskParamsInterface) {
      const { taskId } = rawParams;
      const task = getTask(taskId);
      if (!task) {
        return textResult(`?? ${taskId} ???`, { task: null });
      }
      return textResult(formatTaskAsText(task), { task: buildExecutorTaskView(task) });
    },
  });
}

export function registerGetAllTasks(api: OpenClawPluginApi): void {
  api.logger?.info('[m-team] registering mteam_get_all_tasks');
  api.registerTool({
    name: 'mteam_get_all_tasks',
    label: '??????',
    description: '?????????????',
    parameters: GetAllTasksParams,
    async execute(_toolCallId: string, rawParams: GetAllTasksParamsInterface) {
      const { status } = rawParams;
      const tasks = status ? getTaskRowsByStatus(status) : getAllTasks();

      if (tasks.length === 0) {
        return textResult(status ? `? ${status} ?????` : '?????', { tasks: [] });
      }

      const label = status ? `${status} tasks` : 'All tasks';
      return textResult(formatTaskListAsText(tasks, label), { tasks: buildExecutorTaskViewList(tasks) });
    },
  });
}
