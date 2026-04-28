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
  getAllTasks
} from './queue/index.js';

const DEFAULT_CONFIG = {
  workspaceRoot: null
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
        description: Type.String({ description: '任务描述' }),
        input: Type.Optional(Type.Object({}, { description: '任务输入参数', additionalProperties: true })),
        publisher: Type.Optional(Type.String({ description: '发布者，默认 "user"' })),
        priority: Type.Optional(Type.String({ description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] }))
      }),
      async execute(_toolCallId, rawParams) {
        const description = readStringParam(rawParams, 'description', { required: true });
        const publisher = readStringParam(rawParams, 'publisher') ?? 'user';
        const priority = readStringParam(rawParams, 'priority');
        const taskId = publishTask({
          description,
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
      description: '认领一个待处理任务',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务ID' }),
        agentId: Type.String({ description: '认领者 agentId' })
      }),
      async execute(_toolCallId, rawParams) {
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const agentId = readStringParam(rawParams, 'agentId', { required: true });
        const claimed = claimTask(taskId, agentId);
        return jsonResult({ claimed, taskId });
      }
    });

    // === mteam_update_task ===
    api.registerTool({
      name: 'mteam_update_task',
      description: '更新任务状态或心跳',
      parameters: Type.Object({
        taskId: Type.String({ description: '任务ID' }),
        status: Type.Optional(Type.String({ description: '状态', enum: ['running', 'completed', 'failed', 'pending'] })),
        summary: Type.Optional(Type.String({ description: '结果摘要' })),
        description: Type.Optional(Type.String({ description: '新描述（用于"需下一步"场景）' })),
        result: Type.Optional(Type.Object({}, { description: '完整结果', additionalProperties: true })),
        lastHeartbeatAt: Type.Optional(Type.Number({ description: '心跳时间戳（毫秒）' }))
      }),
      async execute(_toolCallId, rawParams) {
        const taskId = readStringParam(rawParams, 'taskId', { required: true });
        const status = readStringParam(rawParams, 'status');
        const summary = readStringParam(rawParams, 'summary');
        const description = readStringParam(rawParams, 'description');
        const lastHeartbeatAt = readNumberParam(rawParams, 'lastHeartbeatAt');
        const result = rawParams.result ?? null;
        const task = updateTask(taskId, status, result, summary, description, lastHeartbeatAt);
        return jsonResult({ task });
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
