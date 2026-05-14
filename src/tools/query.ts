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
import { resolveAgentIdFromAny } from '../identity.js';
import { type AcceptanceSnapshot } from '../schema/task.js';
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
    async execute(_toolCallId: string, rawParams: GetPendingParamsInterface & {
      toolContext?: OpenClawPluginToolContext;
      __mteamCallerAgentId?: string;
      __mteamSessionKey?: string;
    }) {
      const agentId = resolveAgentIdFromAny({
        explicitAgentId: rawParams.agentId,
        toolContextAgentId: rawParams.toolContext?.agentId,
        explicitSessionKey: (rawParams as Record<string, unknown>).sessionKey as string | undefined,
        toolContextSessionKey: rawParams.toolContext?.sessionKey,
        injectedCallerAgentId: rawParams.__mteamCallerAgentId,
        injectedSessionKey: rawParams.__mteamSessionKey,
      });
      if (!agentId) {
        return textResult('agent identity required', { pending: [], blocked: true, reason: 'AGENT_ID_REQUIRED' });
      }
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
    async execute(_toolCallId: string, rawParams: GetAgentActiveParamsInterface & {
      toolContext?: OpenClawPluginToolContext;
      __mteamCallerAgentId?: string;
      __mteamSessionKey?: string;
    }) {
      const agentId = resolveAgentIdFromAny({
        explicitAgentId: rawParams.agentId,
        toolContextAgentId: rawParams.toolContext?.agentId,
        explicitSessionKey: (rawParams as Record<string, unknown>).sessionKey as string | undefined,
        toolContextSessionKey: rawParams.toolContext?.sessionKey,
        injectedCallerAgentId: rawParams.__mteamCallerAgentId,
        injectedSessionKey: rawParams.__mteamSessionKey,
      });
      if (!agentId) {
        return textResult('agent identity required', { activeTask: null, blocked: true, reason: 'AGENT_ID_REQUIRED' });
      }
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
  __mteamCallerAgentId?: string;
  __mteamSessionKey?: string;
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

function buildPublisherAcceptance(task: NonNullable<ReturnType<typeof getTask>>, workspaceRoot: string): AcceptanceSnapshot & {
  requiredReadRule: string;
} {
  const fallbackTaskDir = normalizePathLike(path.join(workspaceRoot, 'tasks', task.taskId));
  const taskDir = normalizePathLike(task.acceptance?.taskDir || fallbackTaskDir);
  const files = (task.acceptance?.files?.length ? task.acceptance.files : collectPublisherArtifactFiles(task, taskDir)) ?? [];
  const summary = task.acceptance?.summary;

  return {
    taskDir,
    ...(summary ? { summary } : {}),
    files,
    updatedAt: task.acceptance?.updatedAt ?? task.updatedAt,
    source: task.acceptance?.source ?? 'fallback',
    requiredReadRule: 'Read at least one task-scoped path under acceptance.taskDir or acceptance.files before close/reject in heartbeat acceptance.',
  };
}

function formatPublisherAcceptanceText(input: {
  taskId: string;
  status: string;
  taskType: string;
  goal: string;
  acceptance: ReturnType<typeof buildPublisherAcceptance>;
}): string {
  const files = input.acceptance.files ?? [];
  return [
    'Publisher acceptance view',
    `Task: ${input.taskId}`,
    `Status: ${input.status}`,
    `Type: ${input.taskType}`,
    `Goal: ${input.goal}`,
    `Acceptance summary: ${input.acceptance.summary ?? '(empty)'}`,
    `TaskDir: ${input.acceptance.taskDir}`,
    `Files (${files.length}): ${files.length ? files.join(', ') : '(none)'}`,
  ].join('\n');
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

      const callerAgentId = resolveAgentIdFromAny({
        explicitAgentId: (params as Record<string, unknown>).agentId as string | undefined,
        toolContextAgentId: params.toolContext?.agentId,
        explicitSessionKey: (params as Record<string, unknown>).sessionKey as string | undefined,
        toolContextSessionKey: params.toolContext?.sessionKey,
        injectedCallerAgentId: params.__mteamCallerAgentId,
        injectedSessionKey: params.__mteamSessionKey,
      });
      api.logger?.info?.(`[m-team] get_task_for_publisher identity resolved caller=${callerAgentId ?? 'missing'} toolCtxAgent=${params.toolContext?.agentId?.trim() ?? 'missing'} toolCtxSession=${params.toolContext?.sessionKey ?? 'missing'} injectedAgent=${params.__mteamCallerAgentId ?? 'missing'} injectedSession=${params.__mteamSessionKey ?? 'missing'}`);
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

      const acceptance = buildPublisherAcceptance(task, workspaceRoot);
      const includeContext = params.includeContext === true;

      const details = {
        taskId: task.taskId,
        taskType: task.taskType,
        goal: task.goal,
        status: task.status,
        acceptance,
        ...(includeContext ? {
          context: task.context
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
            })),
        } : {}),
      };

      return textResult(formatPublisherAcceptanceText({
        taskId: task.taskId,
        status: task.status,
        taskType: task.taskType,
        goal: task.goal,
        acceptance,
      }), { task: details });
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
