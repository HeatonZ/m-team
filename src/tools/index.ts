/**
 * M-Team Tools — 全部工具注册
 *
 * 类型来源：
 *   AnyAgentTool / OpenClawPluginApi / PluginLogger → openclaw/plugin-sdk/core
 *   jsonResult / readStringParam  → openclaw/plugin-sdk/core
 *   业务逻辑（pool / notifications）                 → ../pool, ../notifications
 */

import type {
  AnyAgentTool,
  OpenClawPluginApi,
  PluginLogger,
} from 'openclaw/plugin-sdk';

import {
  jsonResult,
  readStringParam,
  readNumberParam,
} from 'openclaw/plugin-sdk/core';

// textResult(text, details) 和 failedTextResult 运行时等价，
// SDK 类型声明存在但 runtime 导出路径不在 package.json exports 里，
// 故本地实现（与 SDK 行为一致）。
function textResult<TDetails>(text: string, details: TDetails) {
  return { content: [{ type: 'text' as const, text }], details };
}
const failedTextResult = textResult;

import {
  publishTask,
  claimTask,
  updateTask,
  completeTask,
  relayTask,
  getPendingTasks,
  getAgentActiveTask,
  getTask,
  getAllTasks,
  cancelTask,
  relinquishTask,
  closeTask,
} from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';
import { formatTaskNotifications, formatRelinquishNotifications, formatRelayNotifications, formatPublishNotifications, formatClaimNotifications, formatCancelNotifications, formatCloseNotifications, formatRejectNotifications, sendNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';

// ─── taskId 格式校验（m-team 私有） ─────────────────────────────────────────

/**
 * 读取 taskId 参数（带格式校验）
 * taskId 格式: task_{unix_timestamp}，必须包含前缀
 * LLM 可能截断只取数字部分，此函数显式拒绝并给出完整格式示例
 */
export function readTaskId(
  rawParams: Record<string, unknown> | undefined,
  name: string,
  opts?: { required?: boolean }
): string | undefined {
  const raw = readStringParam(rawParams ?? {}, name, opts);
  if (raw === undefined) return undefined;

  if (/^\d+$/.test(raw)) {
    throw new Error(
      `taskId 不能只写纯数字，需要完整格式 task_1234567890，而非 ${raw}。` +
      `请从任务信息中复制完整的 taskId（含 task_ 前缀）。`
    );
  }

  if (!raw.startsWith('task_')) {
    throw new Error(
      `taskId "${raw}" 格式无效，必须以 task_ 开头（如 task_1234567890）。` +
      `请从任务信息中复制完整的 taskId。`
    );
  }

  return raw;
}

// ─── registerTools ───────────────────────────────────────────────────────────

export interface MTeamPluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
}

export function registerTools(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  try {
  api.logger?.info('[m-team] registerTools start');

  // === mteam_publish_task ===
  api.logger?.info("[m-team] about to register mteam_publish_task");
  api.registerTool({
    name: 'mteam_publish_task',
    description: '发布任务到 M-Team 任务池',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '任务目标（executor 凭此判断任务是否适合自己，必须有区分度，不能只是标题）' },
        description: { type: 'string', description: '当前这一步做什么（每次只写一步，relay 时由上一个 executor 填写下一步）' },
        input: { type: 'object', description: '初始输入数据', additionalProperties: true },
        publisher: { type: 'string', description: '发布者，默认 "user"' },
        priority: { type: 'string', description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] },
      },
      required: ['goal', 'description'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const description = readStringParam(rawParams, 'description', { required: true });
        const goal = readStringParam(rawParams, 'goal', { required: true });
        const publisher = readStringParam(rawParams, 'publisher') ?? 'user';
        const priority = readStringParam(rawParams, 'priority') ?? undefined;
        const taskId = publishTask({ description: description!, goal: goal!, input: rawParams.input as Record<string, unknown> | undefined, publisher, priority: priority ?? undefined });
        const task = getTask(taskId);

        if (task && config.notifications?.length) {
          try {
            const notifications = formatPublishNotifications(task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ taskId });
      } catch (e) {
        return failedTextResult((e as Error)?.message ?? String(e), { status: 'failed' });
      }
    },
  }as AnyAgentTool);

  // === mteam_claim_task ===
  api.logger?.info("[m-team] registering mteam_claim_task");
  api.registerTool({
    name: 'mteam_claim_task',
    description: '认领一个待处理任务（Plugin内部直接创建executor session）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '认领者 agentId' },
      },
      required: ['taskId', 'agentId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const agentId = readStringParam(rawParams, 'agentId', { required: true })!;

        const result = claimTask(taskId, agentId);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        const task = getTask(taskId) ?? result.task;

        if (task && config.notifications?.length) {
          try {
            const notifications = formatClaimNotifications(task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        const sessionKey = `agent:${agentId}:m-team:${taskId}`;
        const taskWorkdir = `${config.workspaceRoot ?? '/mnt/d/code/m-team'}/tasks/${taskId}`;

        const systemPrompt = `
【任务信息】
- 任务ID: ${taskId}
- 任务描述（当前这一步做什么）: ${task?.description ?? ''}
- 执行者 agentId: ${agentId}
- 任务目录: ${taskWorkdir}
- 工作区约束：所有文件操作（读、写、终端命令）必须在任务目录内进行

【必读】执行规范
加载 m-team-executor skill（/skill m-team-executor），严格按照其中的决策框架和检查清单执行。

【任务认领状态】
任务已被心跳 session（${agentId}）认领，处于 RUNNING 状态。
禁止调用 mteam_claim_task——任务不在 PENDING 状态，会失败。

【禁止】
- 在未调用任何工具的情况下自行结束会话（任务将永久卡在 running 状态）
- 在 tool call 的 agentId 参数中传入 subagent 自己的 session agentId，必须传入 ${agentId}
`;

        const subagentRun = api.runtime?.subagent?.run({
          sessionKey,
          message: `[M-Team Task #${taskId}] ${task?.description ?? ''}

${systemPrompt}`,
        }).catch((_runErr: unknown) => {
          (api.logger as PluginLogger)?.error('[m-team] subagent.run 异步启动失败，回滚任务状态');
          relinquishTask(taskId, agentId);
          return { runId: null };
        });

        const subagentResult = await subagentRun;

        return jsonResult({ ...result, runId: subagentResult?.runId, sessionKey });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_update_task ===
  api.logger?.info("[m-team] registering mteam_update_task");
  api.registerTool({
    name: 'mteam_update_task',
    description: '更新任务状态或追加步骤到 context',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '执行者 agentId（追加 context 时必填）' },
        status: { type: 'string', description: '状态', enum: ['running', 'completed', 'failed', 'pending', 'cancelled'] },
        contextStep: { type: 'string', description: '当前步骤描述' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
        description: { type: 'string', description: '更新当前步骤描述（下一步做什么）' },
      },
      required: ['taskId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
        const agentId = readStringParam(rawParams, 'agentId');
        const status = readStringParam(rawParams, 'status');
        const contextStep = readStringParam(rawParams, 'contextStep');
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string } | undefined;
        const description = readStringParam(rawParams, 'description');

        if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
          throw new Error(`Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}`);
        }

        let contextEntry = null;
        if (contextStep) {
          contextEntry = { step: contextStep, output: contextOutput || {} };
        }

        const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, null, agentId ?? null);

        // 发送通知：reject（驳回→pending）单独处理，其他状态不通知
        if (config.notifications?.length && task) {
          const isReject = status === 'pending'
            && contextStep
            && contextStep.includes('驳回');
          if (isReject) {
            try {
              const notifications = formatRejectNotifications(task, config.notifications);
              await sendNotifications(notifications, api.logger as PluginLogger);
            } catch (e) {
              (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
            }
          }
        }

        return jsonResult({ task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_cancel_task ===
  api.logger?.info("[m-team] registering mteam_cancel_task");
  api.registerTool({
    name: 'mteam_cancel_task',
    description: 'Publisher 取消任务（不可再 relay）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
        reason: { type: 'string', description: '取消原因' },
      },
      required: ['taskId', 'publisher'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const publisher = readStringParam(rawParams, 'publisher', { required: true })!;
        const reason = readStringParam(rawParams, 'reason');
        const result = cancelTask(taskId, publisher, reason);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatCancelNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_complete_task ===
  api.logger?.info("[m-team] registering mteam_complete_task");
  api.registerTool({
    name: 'mteam_complete_task',
    description: 'Executor 完成任务（带通知）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        contextStep: { type: 'string', description: '当前步骤描述（必填，必须说明这一步做了什么）' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
      },
      required: ['taskId', 'contextStep'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const contextStep = readStringParam(rawParams, 'contextStep', { required: true })!;
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;

        const contextEntry = { step: contextStep, output: contextOutput || {} };
        const result = completeTask(taskId, contextEntry);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatTaskNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_relay_task ===
  api.logger?.info("[m-team] registering mteam_relay_task");
  api.registerTool({
    name: 'mteam_relay_task',
    description: 'Executor 完成当前步骤并交接给下一个 executor（追加 context 记录这一步，然后放回 pending 池子）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '执行者 agentId' },
        contextStep: { type: 'string', description: '当前步骤描述' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
        description: { type: 'string', description: 'relay 后任务的 description（下一棒看到的内容）' },
      },
      required: ['taskId', 'agentId', 'contextStep', 'description'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
        const contextStep = readStringParam(rawParams, 'contextStep', { required: true })!;
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
        const description = readStringParam(rawParams, 'description', { required: true })!;

        const contextEntry = { step: contextStep, output: contextOutput || {} };
        const result = relayTask(taskId, agentId, contextEntry, undefined, description);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatRelayNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e: unknown) {
        throw e;
      }
    },
  } as AnyAgentTool);

  // === mteam_relinquish_task ===
  api.logger?.info("[m-team] registering mteam_relinquish_task");
  api.registerTool({
    name: 'mteam_relinquish_task',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        executorId: { type: 'string', description: '执行者 agentId' },
        reason: { type: 'string', description: '放弃原因（会在 context step 中记录）' },
      },
      required: ['taskId', 'executorId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const executorId = readStringParam(rawParams, 'executorId', { required: true })!;
        const reason = readStringParam(rawParams, 'reason') ?? 'executor_relinquish';
        const result = relinquishTask(taskId, executorId, reason);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        if (result.success && result.task && config.notifications?.length) {
          try {
            const notifications = formatRelinquishNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ success: result.success, reason: result.reason, task: result.task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_get_pending ===
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
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
        const pending = getPendingTasks(agentId);
        // 认领时只看 description，goal 不暴露给执行者
        const sanitized = pending.map(({ goal: _goal, ...rest }) => rest);
        return jsonResult({ pending: sanitized });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_get_agent_active ===
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
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
        const activeTask = getAgentActiveTask(agentId);
        return jsonResult({ activeTask });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_get_task ===
  api.logger?.info("[m-team] registering mteam_get_task");
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
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
        const task = getTask(taskId);
        return jsonResult({ task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_get_all_tasks ===
  api.registerTool({
    name: 'mteam_get_all_tasks',
    description: '获取所有任务',
    parameters: { type: 'object', properties: {} } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const tasks = getAllTasks();
        return jsonResult({ tasks });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);

  // === mteam_close_task ===
  api.logger?.info("[m-team] registering mteam_close_task");
  api.registerTool({
    name: 'mteam_close_task',
    description: 'Publisher 验收通过，关闭任务（终态）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
      },
      required: ['taskId', 'publisher'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const publisher = readStringParam(rawParams, 'publisher', { required: true })!;
        const result = closeTask(taskId, publisher);
        if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatCloseNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger as PluginLogger);
          } catch (e) {
            (api.logger as PluginLogger)?.warn('[m-team] 通知发送失败');
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e: unknown) {
        throw e;
      }
    },
  }as AnyAgentTool);
  } catch (err) {
    api.logger?.error('[m-team] registerTools failed: ' + String(err));
  }
}
