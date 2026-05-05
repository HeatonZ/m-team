/**
 * M-Team Tools — 全部工具注册
 *
 * 类型来源：
 *   AnyAgentTool / OpenClawPluginApi / PluginLogger → openclaw/plugin-sdk/core
 *   jsonResult / readStringParam / ToolInputError  → openclaw/plugin-sdk/core
 *   业务逻辑（pool / notifications）                 → ../pool, ../notifications
 */

import type {
  AnyAgentTool,
  OpenClawPluginApi,
  PluginLogger,
} from 'openclaw/plugin-sdk/core';
import {
  jsonResult,
  readStringParam as readStr,
  readNumberParam as readNum,
} from 'openclaw/plugin-sdk/core';
import { ToolInputError } from './helpers.js';

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
import { formatTaskNotifications, formatRelinquishNotifications, formatRelayNotifications, formatPublishNotifications, formatClaimNotifications, formatCancelNotifications, formatCloseNotifications, sendNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';

// ─── SDK 类型兼容别名 ────────────────────────────────────────────────────────

/** readStringParam 的 m-team 别名 */
export const readStringParam = readStr;

/** readNumberParam 的 m-team 别名 */
export const readNumberParam = readNum;

/** 保留给外部调用者的别名（向后兼容） */
export { ToolInputError };

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
  const raw = readStr(rawParams ?? {}, name, opts);
  if (raw === undefined) return undefined;

  if (/^\d+$/.test(raw)) {
    throw new ToolInputError(
      `taskId 不能只写纯数字，需要完整格式 task_1234567890，而非 ${raw}。` +
      `请从任务信息中复制完整的 taskId（含 task_ 前缀）。`
    );
  }

  if (!raw.startsWith('task_')) {
    throw new ToolInputError(
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
        const description = readStr(rawParams, 'description', { required: true });
        const goal = readStr(rawParams, 'goal', { required: true });
        const publisher = readStr(rawParams, 'publisher') ?? 'user';
        const priority = readStr(rawParams, 'priority') ?? undefined;
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
        return { ok: false, error: (e as unknown as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const agentId = readStr(rawParams, 'agentId', { required: true })!;

        const result = claimTask(taskId, agentId);
        if (!result.success) return { ok: false, data: result } as Awaited<ReturnType<typeof jsonResult>>;

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
【任务规范 — M-Team 执行者】
你正在执行一个多步骤任务。在调用任何工具之前，你必须先用结构化推理分析当前任务：

1. **理解任务**：用自己的话复述任务目标，确认理解正确
2. **分析步骤**：拆解完成该任务需要哪些子步骤或决策点
3. **制定计划**：确定先做什么、后做什么
4. **执行并验证**：调用工具执行，完成后检查结果是否符合预期

只有在完成上述推理后，才能按计划调用工具。

当前任务信息：
- 任务ID: ${taskId}
- 任务描述: ${task?.description ?? ''}
- 核心目标: ${task?.goal ?? ''}
- 执行者 agentId: ${agentId}
- 任务目录: ${taskWorkdir}

【必读】角色规范文件：
- SOUL.md
- AGENTS.md
- mteam-executor skill（执行方法论）：{workspaceRoot}/skills/ai-frameworks/mteam-executor/SKILL.md

【重要】任务认领状态：
任务已被心跳 session（${agentId}）认领，处于 RUNNING 状态。
**禁止调用 mteam_claim_task**——任务不在 PENDING 状态，claim 会失败。
直接执行任务即可。

【工具使用规范】

**判断顺序：做完这步后，先判断是否 relay，再判断是否 complete。不要倒过来。**

| 1. 交接任务（交给下一个 agent 继续）→ 调用 mteam_relay_task
|    - 当你完成当前这一步后，任务还有后续步骤需要其他人接力时使用
|    - 这是多步骤任务的正常出口，**不是失败**
|
| 2. 完成任务（最终完成）→ 调用 mteam_complete_task
|    - **只有当任务的完整 goal 已全部达成时**才使用
|    - 不确定 goal 是否全部达成 → 先 relay，不要直接 complete
|
| 3. 主动放弃（放回 pending 不追加 context）→ 调用 mteam_relinquish_task
|    - 当你无法继续执行，需要暂时放弃时使用

| 【禁止】
| - 调用 mteam_claim_task——任务已被认领，claim 会返回 NOT_PENDING
| - 在未调用任何工具的情况下自行结束会话，任务将永久卡在 running 状态
| - 在 tool call 的 agentId 参数中传入 subagent 自己的 session agentId，必须传入 ${agentId}
|`;

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒）' },
      },
      required: ['taskId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const agentId = readStr(rawParams, 'agentId');
        const status = readStr(rawParams, 'status');
        const contextStep = readStr(rawParams, 'contextStep');
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
        const description = readStr(rawParams, 'description');
        const lastHeartbeatAt = readNum(rawParams, 'lastHeartbeatAt');

        if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
          throw new ToolInputError(`Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}`);
        }

        let contextEntry = null;
        if (contextStep) {
          contextEntry = { step: contextStep, output: contextOutput || {} };
        }

        const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, lastHeartbeatAt ?? null, agentId ?? null);
        return jsonResult({ task });
      } catch (e: unknown) {
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const publisher = readStr(rawParams, 'publisher', { required: true })!;
        const reason = readStr(rawParams, 'reason');
        const result = cancelTask(taskId, publisher, reason);
        if (!result.success) return { ok: false, data: result };

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const contextStep = readStr(rawParams, 'contextStep', { required: true })!;
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;

        const contextEntry = { step: contextStep, output: contextOutput || {} };
        const result = completeTask(taskId, contextEntry);
        if (!result.success) return { ok: false, data: result };

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒），relay 时携带以便追踪' },
      },
      required: ['taskId', 'agentId', 'contextStep'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>): Promise<Awaited<ReturnType<typeof jsonResult>>> {
      try {
        const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
        const agentId = readStr(rawParams, 'agentId', { required: true })!;
        const contextStep = readStr(rawParams, 'contextStep', { required: true })!;
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
        const lastHeartbeatAt = readNum(rawParams, 'lastHeartbeatAt');

        const contextEntry = { step: contextStep, output: contextOutput || {} };
        const result = relayTask(taskId, agentId, contextEntry, lastHeartbeatAt ?? undefined);
        if (!result.success) return { ok: false, data: result };

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const executorId = readStr(rawParams, 'executorId', { required: true })!;
        const reason = readStr(rawParams, 'reason') ?? 'executor_relinquish';
        const result = relinquishTask(taskId, executorId, reason);
        if (!result.success) return { ok: false, data: result };

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const agentId = readStr(rawParams, 'agentId', { required: true })!;
        const pending = getPendingTasks(agentId);
        return jsonResult({ pending });
      } catch (e: unknown) {
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const agentId = readStr(rawParams, 'agentId', { required: true })!;
        const activeTask = getAgentActiveTask(agentId);
        return jsonResult({ activeTask });
      } catch (e: unknown) {
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const task = getTask(taskId);
        return jsonResult({ task });
      } catch (e: unknown) {
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
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
        const publisher = readStr(rawParams, 'publisher', { required: true })!;
        const result = closeTask(taskId, publisher);
        if (!result.success) return { ok: false, data: result };

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
        return { ok: false, error: (e as Error)?.message ?? String(e) } as Awaited<ReturnType<typeof jsonResult>>;
      }
    },
  }as AnyAgentTool);
  } catch (err) {
    api.logger?.error('[m-team] registerTools failed: ' + String(err));
  }
}
