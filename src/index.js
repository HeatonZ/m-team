/**
 * M-Team Plugin — 去中心化任务池协作
 * OpenClaw pluginApi: 2026.4.22
 */

import fs from 'node:fs';
import path from 'node:path';
import { definePluginEntry, emptyPluginConfigSchema, jsonResult, readStringParam, readNumberParam } from 'openclaw/plugin-sdk/core';
import { Type } from '@sinclair/typebox';
import {
  setWorkspaceRoot,
  publishTask,
  claimTask,
  getPendingTasks,
  getAgentActiveTask,
  updateTask,
  getTask,
  getAllTasks,
  cancelTask,
  relinquishTask,
  formatTaskNotifications
} from './queue/index.js';

const DEFAULT_CONFIG = {
  workspaceRoot: null,
  notifications: []
};

let config = { ...DEFAULT_CONFIG };

function getTasksDir() {
  return path.join(config.workspaceRoot, 'tasks');
}

function getQueueDir() {
  return path.join(config.workspaceRoot, 'queue');
}

export default definePluginEntry({
  id: 'm-team',
  name: 'M-Team 去中心化任务池',
  description: '去中心化任务池协作插件 — 多Agent任务分发与执行',
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    config.workspaceRoot = pluginConfig.workspaceRoot || DEFAULT_CONFIG.workspaceRoot;
    config.notifications = pluginConfig.notifications || DEFAULT_CONFIG.notifications;

    if (!config.workspaceRoot) {
      api.logger?.warn('[m-team] 未配置 workspaceRoot，跳过初始化');
      return;
    }

    fs.mkdirSync(config.workspaceRoot, { recursive: true });
    fs.mkdirSync(getTasksDir(), { recursive: true });
    fs.mkdirSync(getQueueDir(), { recursive: true });

    setWorkspaceRoot(config.workspaceRoot);

    // === mteam_publish_task ===
    api.registerTool({
      name: 'mteam_publish_task',
      description: '发布任务到 M-Team 任务池',
      parameters: Type.Object({
        description: Type.String({ description: '第一步的描述' }),
        goal: Type.String({ description: '核心目标，不可更改' }),
        input: Type.Optional(Type.Object({}, { description: '初始输入数据', additionalProperties: true })),
        publisher: Type.Optional(Type.String({ description: '发布者，默认 "user"' })),
        priority: Type.Optional(Type.String({ description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] }))
      }),
      async execute(_toolCallId, rawParams) {
        const description = readStringParam(rawParams, 'description', { required: true });
        const goal = readStringParam(rawParams, 'goal', { required: true });
        const publisher = readStringParam(rawParams, 'publisher') ?? 'user';
        const priority = readStringParam(rawParams, 'priority');
        const taskId = publishTask({
          description,
          goal,
          input: rawParams.input ?? {},
          publisher,
          priority
        });
        return jsonResult({ taskId });
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
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const agentId = readStringParam(rawParams, 'agentId', { required: true });

        // 1. Claim 任务
        const result = claimTask(taskId, agentId);
        if (!result.ok) return jsonResult(result);

        // 2. 获取完整 task 信息用于创建 session
        const task = result.task ?? getTask(taskId);

        // 3. Plugin 内部直接创建 executor session
        //    sessionKey 格式: mteam:{taskId}:executor
        //    HEARTBEAT 模板解析 sessionKey 提取 taskId
        const sessionKey = `mteam:${taskId}:executor`;
        const runResult = await api.runtime.subagent.run({
          sessionKey,
          message: `[M-Team Task #${taskId}] ${task?.description ?? ''}`
        });

        return jsonResult({
          ...result,
          runId: runResult.runId,
          sessionKey
        });
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
        // 追加到 context 的步骤
        contextStep: Type.Optional(Type.String({ description: '当前步骤描述' })),
        contextOutput: Type.Optional(Type.Object({
          summary: Type.Optional(Type.String({ description: '步骤摘要' })),
          files: Type.Optional(Type.Array(Type.String(), { description: '任务文件夹内的相对路径' }))
        }, { description: '步骤输出' })),
        // 更新当前步骤描述（下一个 executor 看到的内容）
        description: Type.Optional(Type.String({ description: '更新当前步骤描述（下一步做什么）' })),
        lastHeartbeatAt: Type.Optional(Type.Number({ description: '心跳时间戳（毫秒）' }))
      }),
      async execute(_toolCallId, rawParams) {
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const agentId = readStringParam(rawParams, 'agentId');
        const status = readStringParam(rawParams, 'status');
        const contextStep = readStringParam(rawParams, 'contextStep');
        const contextOutput = rawParams.contextOutput ?? null;
        const description = readStringParam(rawParams, 'description');
        const lastHeartbeatAt = readNumberParam(rawParams, 'lastHeartbeatAt');

        let contextEntry = null;
        if (contextStep) {
          contextEntry = { step: contextStep };
        }

        const task = updateTask(taskId, status, contextEntry, description, lastHeartbeatAt, agentId);

        // 任务完成时，生成通知内容
        let notifications = null;
        if (task && status === 'completed' && config.notifications?.length > 0) {
          notifications = formatTaskNotifications(task, config.notifications);
        }

        return jsonResult({ task, notifications });
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
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const publisher = readStringParam(rawParams, 'publisher', { required: true });
        const reason = readStringParam(rawParams, 'reason');
        const result = cancelTask(taskId, publisher, reason);
        return jsonResult(result);
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
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const executorId = readStringParam(rawParams, 'executorId', { required: true });
        const result = relinquishTask(taskId, executorId);
        return jsonResult(result);
      }
    });

    // === mteam_get_pending ===
    api.registerTool({
      name: 'mteam_get_pending',
      description: '获取待认领任务列表（agent 有进行中任务时返回空）',
      parameters: Type.Object({
        agentId: Type.Optional(Type.String({ description: '过滤：agentId' }))
      }),
      async execute(_toolCallId, rawParams) {
        const agentId = readStringParam(rawParams, 'agentId');
        const pending = getPendingTasks(agentId ?? null);
        return jsonResult({ pending });
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
        const agentId = readStringParam(rawParams, 'agentId', { required: true });
        const activeTask = getAgentActiveTask(agentId);
        return jsonResult({ activeTask });
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
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const task = getTask(taskId);
        return jsonResult({ task });
      }
    });

    // === mteam_get_all_tasks ===
    api.registerTool({
      name: 'mteam_get_all_tasks',
      description: '获取所有任务',
      parameters: Type.Object({}),
      async execute(_toolCallId, rawParams) {
        const tasks = getAllTasks();
        return jsonResult({ tasks });
      }
    });

    api.logger?.info('[m-team] 任务池协作插件已激活');
    api.logger?.info(`[m-team] Workspace: ${config.workspaceRoot}`);
    api.logger?.info(`[m-team] Tasks: ${getTasksDir()}`);
    api.logger?.info(`[m-team] Queue: ${getQueueDir()}`);
  }
});
