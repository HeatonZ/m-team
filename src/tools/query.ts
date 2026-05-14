/**
 * Read-only query tools.
 */

import path from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { OpenClawPluginToolContext } from '../types/openclaw-hooks.js';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, readTaskId } from './shared.js';
import { getPendingTasks, getAgentActiveTask, getTask, getAllTasks, getTaskRowsByStatus } from '../pool/index.js';
import { buildExecutorTaskView, buildExecutorTaskViewList, formatTaskAsText, formatTaskLine, formatTaskListAsText } from './helpers.js';
import {
  GetPendingParams,
  GetAgentActiveParams,
  GetTaskParams,
  GetTaskForPublisherParams,
  GetAllTasksParams,
} from '../types/tools.js';
import type {
  GetPendingParamsInterface,
  GetAgentActiveParamsInterface,
  GetTaskParamsInterface,
  GetTaskForPublisherParamsInterface,
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

type PublisherQueryToolParams = GetTaskForPublisherParamsInterface & {
  toolContext?: OpenClawPluginToolContext;
};

const DEFAULT_WORKSPACE_ROOT = '/mnt/d/code/m-team';

function normalizePathLike(input: string): string {
  return input
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
}

function isAbsolutePathLike(input: string): boolean {
  return input.startsWith('/') || /^[a-zA-Z]:\//.test(input);
}

function collectPublisherArtifactFiles(task: NonNullable<ReturnType<typeof getTask>>, taskDir: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of task.context ?? []) {
    if (entry.type !== 'step') continue;
    for (const rawFile of entry.output?.files ?? []) {
      const normalizedRaw = normalizePathLike(rawFile);
      if (!normalizedRaw) continue;

      const resolved = isAbsolutePathLike(normalizedRaw)
        ? normalizedRaw
        : normalizePathLike(path.join(taskDir, normalizedRaw));

      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      out.push(resolved);
    }
  }

  return out;
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

export function registerGetTaskForPublisher(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  api.logger?.info('[m-team] registering mteam_get_task_for_publisher');
  const publishers = new Set(config.publishers ?? []);
  const workspaceRoot = config.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  api.registerTool({
    name: 'mteam_get_task_for_publisher',
    label: 'Get task detail for publisher',
    description: 'Show publisher acceptance view including goal, full context and artifacts',
    parameters: GetTaskForPublisherParams,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as PublisherQueryToolParams;
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const task = getTask(taskId);
      if (!task) {
        return textResult(`Task ${taskId} not found`, { task: null });
      }

      const callerAgentId = params.toolContext?.agentId?.trim();
      if (!callerAgentId || !publishers.has(callerAgentId)) {
        return textResult('forbidden: publisher identity required', {
          blocked: true,
          reason: 'PUBLISHER_IDENTITY_REQUIRED',
        });
      }

      if (task.publisher !== callerAgentId) {
        return textResult(`forbidden: task publisher mismatch (task.publisher=${task.publisher}, caller=${callerAgentId})`, {
          blocked: true,
          reason: 'PUBLISHER_TASK_OWNERSHIP_REQUIRED',
        });
      }

      const taskDir = normalizePathLike(path.join(workspaceRoot, 'tasks', task.taskId));
      const artifactFiles = collectPublisherArtifactFiles(task, taskDir);

      const stepContext = task.context
        .filter((entry) => entry.type === 'step')
        .map((entry) => ({
          type: entry.type,
          executor: entry.executor,
          step: entry.step,
          output: {
            ...(entry.output?.summary ? { summary: entry.output.summary } : {}),
            ...(entry.output?.files?.length ? { files: entry.output.files } : {}),
            ...(entry.output?.unresolvedIssues?.length ? { unresolvedIssues: entry.output.unresolvedIssues } : {}),
            ...(entry.output?.error ? { error: entry.output.error } : {}),
          },
          completedAt: entry.completedAt,
        }));

      const details = {
        taskId: task.taskId,
        taskType: task.taskType,
        goal: task.goal,
        description: task.description,
        status: task.status,
        priority: task.priority,
        publisher: task.publisher,
        executor: task.executor,
        lastExecutor: task.lastExecutor,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        context: stepContext,
        acceptance: {
          taskDir,
          artifactFiles,
          requiredReadRule: 'Read at least one task-scoped path under taskDir or artifactFiles before close/reject in heartbeat acceptance.',
        },
      };

      return textResult(formatTaskAsText(task, { includeGoal: true }), { task: details });
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
