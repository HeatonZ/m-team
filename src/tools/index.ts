/**
 * M-Team Tools — 全部工具注册
 */


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
  relinquishTask
} from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';
import { readStr, readNum, jsonResult } from './helpers.js';
import {
  formatTaskNotifications,
  formatRelinquishNotifications,
  formatRelayNotifications,
  formatPublishNotifications,
  formatClaimNotifications,
  formatCancelNotifications,
  sendNotifications,
  type NotificationConfig
} from '../notifications.js';

// ============================================================
// OpenClaw Plugin API 类型（内联，无外部依赖）
// ============================================================

interface ToolParameterProperty {
  type?: string;
  description?: string;
  enum?: string[];
  additionalProperties?: boolean | ToolParameterProperty;
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
}

interface ToolParameter {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
  execute(toolCallId: string, rawParams: Record<string, unknown>): Promise<unknown> | unknown;
}

interface RuntimeSubagent {
  run(opts: { sessionKey: string; message: string }): Promise<{ runId: string }>;
}

export interface OpenClawApi {
  logger?: Logger;
  config?: {
    accounts?: Array<{ type?: string; provider?: string; id?: string; accountId?: string }>;
  };
  pluginConfig?: PluginConfig;
  runtime?: { subagent?: RuntimeSubagent };
  registerTool(tool: ToolDefinition): void;
  on(event: string, handler: (event: Record<string, unknown>) => Promise<void>): void;
}

interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
}

interface PluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
}

// ============================================================
// 工具注册
// ============================================================

export function registerTools(api: OpenClawApi, config: PluginConfig): void {

  // === mteam_publish_task ===
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
        priority: { type: 'string', description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] }
      },
      required: ['goal', 'description']
    },
    async execute(_toolCallId, rawParams) {
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
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        return jsonResult({ taskId });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_claim_task ===
  api.registerTool({
    name: 'mteam_claim_task',
    description: '认领一个待处理任务（Plugin内部直接创建executor session）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '认领者 agentId' }
      },
      required: ['taskId', 'agentId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const agentId = readStr(rawParams, 'agentId', { required: true })!;

        const result = claimTask(taskId, agentId);
        if (!result.success) return { ok: false, data: result };

        // claim 后重新读，拿 relay 后最新的 description（claim 返回的 result.task 是事务快照）
        const task = getTask(taskId) ?? result.task;

        if (task && config.notifications?.length) {
          try {
            const notifications = formatClaimNotifications(task, config.notifications);
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        // Plugin 内部直接创建 executor session
        // 注意：任务已由心跳 session 认领，subagent 不需要重复 claim
        const sessionKey = `mteam:${taskId}:${agentId}:${Date.now()}`;
        const executorAgentId = agentId; // 任务指定的执行者（而非 subagent 的 session agentId）
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
- 任务描述: ${task.description ?? ''}
- 核心目标: ${task.goal ?? ''}
- 执行者 agentId: ${executorAgentId}

【重要】任务认领状态：
任务已被心跳 session（${executorAgentId}）认领，处于 RUNNING 状态。
**禁止调用 mteam_claim_task**——任务不在 PENDING 状态，claim 会失败。
直接执行任务即可。

【工具使用规范】
所有工具调用必须传入正确的 executorAgentId（${executorAgentId}），不能用 subagent 自己的 session agentId。

|1. 完成任务（最终完成）→ 调用 mteam_complete_task
|   - 当你认为任务目标已全部达成，不需要再交接给其他 agent 时使用
|   - contextStep 描述你具体做了什么，contextOutput.summary 包含可验证的结果摘要

|2. 完成任务并交接（交给下一个 agent 继续）→ 调用 mteam_relay_task
|   - 当任务未完成，还有后续步骤需要其他 agent 继续执行时使用
|   - relay 后任务回到待认领状态，下一个 agent 会接手

|3. 主动放弃（放回 pending 不追加 context）→ 调用 mteam_relinquish_task
|   - 当你无法继续执行，需要暂时放弃时使用

|【禁止】
|- 调用 mteam_claim_task——任务已被认领，claim 会返回 NOT_PENDING
|- 认领任务后不要立刻调用 mteam_complete_task，先用 mteam_get_task 读取 context，再实际执行任务
|- 在未调用任何工具的情况下自行结束会话，任务将永久卡在 running 状态
|- 在 tool call 的 agentId 参数中传入 subagent 自己的 session agentId，必须传入 ${executorAgentId}
|`;

        // Fire-and-forget: 不等待 executor 完成，让 heartbeat session 能立刻回复 HEARTBEAT_OK
        // executor 的结果由 subagent_ended hook 统一处理（completeTask / failTask）
        api.runtime!.subagent!.run({
          sessionKey,
          agentId,  // subagent 以心跳 session 的身份运行
          message: `[M-Team Task #${taskId}] ${task.description ?? ''}

[系统信息] executorAgentId=${executorAgentId}
${systemPrompt}`
        }).catch((runErr) => {
          // 异步启动失败，回滚 claim 状态
          api.logger?.error('[m-team] subagent.run 异步启动失败，回滚任务状态', {
            taskId,
            error: (runErr as Error)?.message ?? String(runErr)
          });
          relinquishTask(taskId, agentId);
        });

        return jsonResult({ ...result, sessionKey });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_update_task ===
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
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' }
          }
        },
        description: { type: 'string', description: '更新当前步骤描述（下一步做什么）' },
        lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒）' }
      },
      required: ['taskId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const agentId = readStr(rawParams, 'agentId');
        const status = readStr(rawParams, 'status');
        const contextStep = readStr(rawParams, 'contextStep');
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
        const description = readStr(rawParams, 'description');
        const lastHeartbeatAt = readNum(rawParams, 'lastHeartbeatAt');

        if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
          return { ok: false, error: `Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}` };
        }

        let contextEntry = null;
        if (contextStep) {
          contextEntry = { step: contextStep, output: contextOutput || {} };
        }

        const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, lastHeartbeatAt ?? null, agentId ?? null);
        return jsonResult({ task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_cancel_task ===
  api.registerTool({
    name: 'mteam_cancel_task',
    description: 'Publisher 取消任务（不可再 relay）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
        reason: { type: 'string', description: '取消原因' }
      },
      required: ['taskId', 'publisher']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const publisher = readStr(rawParams, 'publisher', { required: true })!;
        const reason = readStr(rawParams, 'reason');
        const result = cancelTask(taskId, publisher, reason);
        if (!result.success) return { ok: false, data: result };

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatCancelNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_complete_task ===
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
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' }
          }
        }
      },
      required: ['taskId', 'contextStep']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const contextStep = readStr(rawParams, 'contextStep', { required: true })!;
        const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;

        const contextEntry = { step: contextStep, output: contextOutput || {} };
        const result = completeTask(taskId, contextEntry);
        if (!result.success) return { ok: false, data: result };

        if (result.task && config.notifications?.length) {
          try {
            const notifications = formatTaskNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_relay_task ===
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
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' }
          }
        },
        lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒），relay 时携带以便追踪' }
      },
      required: ['taskId', 'agentId', 'contextStep']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
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
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        return jsonResult({ success: result.success, task: result.task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_relinquish_task ===
  api.registerTool({
    name: 'mteam_relinquish_task',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        executorId: { type: 'string', description: '执行者 agentId' },
        reason: { type: 'string', description: '放弃原因（会在 context step 中记录）' }
      },
      required: ['taskId', 'executorId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const executorId = readStr(rawParams, 'executorId', { required: true })!;
        const reason = readStr(rawParams, 'reason') ?? 'executor_relinquish';
        const result = relinquishTask(taskId, executorId, reason);
        if (!result.success) return { ok: false, data: result };

        if (result.success && result.task && config.notifications?.length) {
          try {
            const notifications = formatRelinquishNotifications(result.task, config.notifications);
            await sendNotifications(notifications, api.logger);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败', { error: (e as Error)?.message });
          }
        }

        return jsonResult({ success: result.success, reason: result.reason, task: result.task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_get_pending ===
  api.registerTool({
    name: 'mteam_get_pending',
    description: '获取 agent 的待认领任务列表（该 agent 有进行中任务时返回空）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' }
      },
      required: ['agentId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const agentId = readStr(rawParams, 'agentId', { required: true })!;
        const pending = getPendingTasks(agentId);
        return jsonResult({ pending });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_get_agent_active ===
  api.registerTool({
    name: 'mteam_get_agent_active',
    description: '获取 agent 当前进行中的任务（一个 agent 不能同时做多个任务）',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'agentId' }
      },
      required: ['agentId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const agentId = readStr(rawParams, 'agentId', { required: true })!;
        const activeTask = getAgentActiveTask(agentId);
        return jsonResult({ activeTask });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_get_task ===
  api.registerTool({
    name: 'mteam_get_task',
    description: '获取任务详情',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' }
      },
      required: ['taskId']
    },
    async execute(_toolCallId, rawParams) {
      try {
        const taskId = readStr(rawParams, 'taskId', { required: true })!;
        const task = getTask(taskId);
        return jsonResult({ task });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });

  // === mteam_get_all_tasks ===
  api.registerTool({
    name: 'mteam_get_all_tasks',
    description: '获取所有任务',
    parameters: { type: 'object', properties: {} },
    async execute(_toolCallId) {
      try {
        const tasks = getAllTasks();
        return jsonResult({ tasks });
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) };
      }
    }
  });
}
