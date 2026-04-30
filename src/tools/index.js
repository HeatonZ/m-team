/**
 * M-Team Tools — 全部工具注册
 */

import { Type } from '@sinclair/typebox';
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
  formatTaskNotifications,
  formatRelinquishNotifications
} from '../pool/index.js';
import { TaskStatus, VALID_PRIORITIES } from '../schema/task.js';
import { readStr, readNum, jsonResult } from './helpers.js';
import { sendNotifications } from '../notifications.js';

/**
 * @param {object} api - OpenClaw plugin api
 * @param {object} config - plugin config (notifications, etc.)
 */
export function registerTools(api, config) {

  // === mteam_publish_task ===
  api.registerTool({
    name: 'mteam_publish_task',
    description: '发布任务到 M-Team 任务池',
    parameters: Type.Object({
      goal: Type.String({ description: '任务目标（executor 凭此判断任务是否适合自己，必须有区分度，不能只是标题）' }),
      description: Type.String({ description: '当前这一步做什么（每次只写一步，relay 时由上一个 executor 填写下一步）' }),
      input: Type.Optional(Type.Object({}, { description: '初始输入数据', additionalProperties: true })),
      publisher: Type.Optional(Type.String({ description: '发布者，默认 "user"' })),
      priority: Type.Optional(Type.String({ description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] }))
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const description = readStr(rawParams, 'description', { required: true });
      const goal = readStr(rawParams, 'goal', { required: true });
      const publisher = readStr(rawParams, 'publisher') ?? 'user';
      const priority = readStr(rawParams, 'priority');
      const taskId = publishTask({ description, goal, input: rawParams.input ?? {}, publisher, priority });
      return jsonResult({ taskId });

      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_claim_task ===
  api.registerTool({
    name: 'mteam_claim_task',
    description: '认领一个待处理任务（Plugin内部直接创建executor session）',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      agentId: Type.String({ description: '认领者 agentId' })
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const agentId = readStr(rawParams, 'agentId', { required: true });

      // 1. Claim 任务
      const result = claimTask(taskId, agentId);
      if (!result.success) return { ok: false, data: result };

      // 2. 获取完整 task 信息用于创建 session
      const task = result.task;

      // 3. Plugin 内部直接创建 executor session
      //    sessionKey 格式: mteam:{taskId}:{agentId}:{timestamp}
      //    relay 后同一个 agent 重新 claim 也不会冲突
      const sessionKey = `mteam:${taskId}:${agentId}:${Date.now()}`;
      const systemPrompt = `\n【任务规范 — M-Team 执行者】\n你正在执行一个多步骤任务。当前任务信息：\n- 任务ID: ${taskId}\n- 任务描述: ${task?.description ?? ''}\n- 核心目标: ${task?.goal ?? ''}\n\n【工具使用规范】\n1. 完成任务（最终完成）→ 调用 mteam_complete_task\n   - 当你认为任务目标已全部达成，不需要再交接给其他 agent 时使用\n   - contextStep 描述你具体做了什么，contextOutput.summary 包含可验证的结果摘要\n\n2. 完成任务并交接（交给下一个 agent 继续）→ 调用 mteam_relay_task\n   - 当任务未完成，还有后续步骤需要其他 agent 继续执行时使用\n   - relay 后任务回到待认领状态，下一个 agent 会接手\n\n3. 主动放弃（放回 pending 不追加 context）→ 调用 mteam_relinquish_task\n   - 当你无法继续执行，需要暂时放弃时使用\n\n【禁止】\n- 在未调用任何工具的情况下自行结束会话，任务将永久卡在 running 状态\n`;

      const runResult = await api.runtime.subagent.run({
        sessionKey,
        message: `[M-Team Task #${taskId}] ${task?.description ?? ''}${systemPrompt}`
      });

      return jsonResult({ ...result, runId: runResult.runId, sessionKey });

      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_update_task ===
  api.registerTool({
    name: 'mteam_update_task',
    description: '更新任务状态或追加步骤到 context',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      agentId: Type.Optional(Type.String({ description: '执行者 agentId（追加 context 时必填）' })),
      status: Type.Optional(Type.String({ description: '状态', enum: ['running', 'completed', 'failed', 'pending', 'cancelled'] })),
      contextStep: Type.Optional(Type.String({ description: '当前步骤描述' })),
      contextOutput: Type.Optional(Type.Object({
        summary: Type.Optional(Type.String({ description: '步骤摘要' })),
        files: Type.Optional(Type.Array(Type.String(), { description: '任务文件夹内的相对路径' }))
      }, { description: '步骤输出' })),
      description: Type.Optional(Type.String({ description: '更新当前步骤描述（下一步做什么）' })),
      lastHeartbeatAt: Type.Optional(Type.Number({ description: '心跳时间戳（毫秒）' }))
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const agentId = readStr(rawParams, 'agentId');
      const status = readStr(rawParams, 'status');
      const contextStep = readStr(rawParams, 'contextStep');
      const contextOutput = rawParams.contextOutput ?? null;
      const description = readStr(rawParams, 'description');
      const lastHeartbeatAt = readNum(rawParams, 'lastHeartbeatAt');

      // 枚举校验：非法 status 直接拒绝
      if (status !== undefined && !Object.values(TaskStatus).includes(status)) {
        return { ok: false, error: `Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}` };
      }

      let contextEntry = null;
      if (contextStep) {
        contextEntry = { step: contextStep, output: contextOutput || {} };
      }

      const task = updateTask(taskId, status, contextEntry, description, lastHeartbeatAt, agentId);
      return jsonResult({ task });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_cancel_task ===
  api.registerTool({
    name: 'mteam_cancel_task',
    description: 'Publisher 取消任务（不可再 relay）',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      publisher: Type.String({ description: '发布者（需与创建时 publisher 一致）' }),
      reason: Type.Optional(Type.String({ description: '取消原因' }))
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const publisher = readStr(rawParams, 'publisher', { required: true });
      const reason = readStr(rawParams, 'reason');
      const result = cancelTask(taskId, publisher, reason);
      if (!result.success) return { ok: false, data: result };
      return jsonResult({ success: result.success, task: result.task });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_complete_task ===
  api.registerTool({
    name: 'mteam_complete_task',
    description: 'Executor 完成任务（带通知）',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      contextStep: Type.String({ description: '当前步骤描述（必填，必须说明这一步做了什么）' }),
      contextOutput: Type.Optional(Type.Object({
        summary: Type.Optional(Type.String({ description: '步骤摘要' })),
        files: Type.Optional(Type.Array(Type.String(), { description: '任务文件夹内的相对路径' }))
      }, { description: '步骤输出' }))
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const contextStep = readStr(rawParams, 'contextStep', { required: true });
      const contextOutput = rawParams.contextOutput ?? null;

      const contextEntry = { step: contextStep, output: contextOutput || {} };

      const result = completeTask(taskId, contextEntry);
      if (!result.success) return { ok: false, data: result };

      // 发送完成通知（内部发送，不返回给调用方）
      if (result.task && config.notifications?.length > 0) {
        const notifications = formatTaskNotifications(result.task, config.notifications);
        await sendNotifications(notifications, api);
      }

      return jsonResult({ success: result.success, task: result.task });

      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_relay_task ===
  api.registerTool({
    name: 'mteam_relay_task',
    description: 'Executor 完成当前步骤并交接给下一个 executor（追加 context 记录这一步，然后放回 pending 池子）',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      agentId: Type.String({ description: '执行者 agentId' }),
      contextStep: Type.String({ description: '当前步骤描述' }),
      contextOutput: Type.Optional(Type.Object({
        summary: Type.Optional(Type.String({ description: '步骤摘要' })),
        files: Type.Optional(Type.Array(Type.String(), { description: '任务文件夹内的相对路径' }))
      }, { description: '步骤输出' }))
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const agentId = readStr(rawParams, 'agentId', { required: true });
      const contextStep = readStr(rawParams, 'contextStep', { required: true });
      const contextOutput = rawParams.contextOutput ?? null;

      const contextEntry = { step: contextStep, output: contextOutput || {} };
      const result = relayTask(taskId, agentId, contextEntry);
      if (!result.success) return { ok: false, data: result };

      // relay 不发通知（交接是正常流程，不是异常放弃）
      return jsonResult({ success: result.success, task: result.task });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_relinquish_task ===
  api.registerTool({
    name: 'mteam_relinquish_task',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' }),
      executorId: Type.String({ description: '执行者 agentId' })
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const executorId = readStr(rawParams, 'executorId', { required: true });
      const result = relinquishTask(taskId, executorId);
      if (!result.success) return { ok: false, data: result };

      // 发送放回池子通知（内部发送，不返回给调用方）
      if (result.success && result.task && config.notifications?.length > 0) {
        const notifications = formatRelinquishNotifications(result.task, config.notifications);
        await sendNotifications(notifications, api);
      }

      return jsonResult({ success: result.success, reason: result.reason, task: result.task });

      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_get_pending ===
  api.registerTool({
    name: 'mteam_get_pending',
    description: '获取 agent 的待认领任务列表（该 agent 有进行中任务时返回空）',
    parameters: Type.Object({
      agentId: Type.String({ description: 'agentId' })
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const agentId = readStr(rawParams, 'agentId', { required: true });
      const pending = getPendingTasks(agentId);
      return jsonResult({ pending });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_get_agent_active ===
  api.registerTool({
    name: 'mteam_get_agent_active',
    description: '获取 agent 当前进行中的任务（一个 agent 不能同时做多个任务）',
    parameters: Type.Object({
      agentId: Type.String({ description: 'agentId' })
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const agentId = readStr(rawParams, 'agentId', { required: true });
      const activeTask = getAgentActiveTask(agentId);
      return jsonResult({ activeTask });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_get_task ===
  api.registerTool({
    name: 'mteam_get_task',
    description: '获取任务详情',
    parameters: Type.Object({
      taskId: Type.String({ description: '任务ID' })
    }),
    async execute(_toolCallId, rawParams) {
      try {

      const taskId = readStr(rawParams, 'taskId', { required: true });
      const task = getTask(taskId);
      return jsonResult({ task });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });

  // === mteam_get_all_tasks ===
  api.registerTool({
    name: 'mteam_get_all_tasks',
    description: '获取所有任务',
    parameters: Type.Object({}),
    async execute(_toolCallId, rawParams) {
      try {

      const tasks = getAllTasks();
      return jsonResult({ tasks });
    
      } catch(e) { return { ok: false, error: e?.message ?? String(e) }; }
    }
  });
}
