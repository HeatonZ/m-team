/**
 * M-Team Plugin — 去中心化任务池协作
 * OpenClaw pluginApi: 2026.4.22
 */

import fs from 'node:fs';
import path from 'node:path';
import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/plugin-entry';
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

    api.registerTool({
      name: 'mteam_publish_task',
      description: '发布任务到队列',
      input: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '任务描述' },
          input: { type: 'object', description: '任务输入参数' },
          initiator: { type: 'string', description: '发起者' },
          priority: { type: 'string', enum: ['high', 'normal', 'low'], description: '优先级，默认 normal' }
        },
        required: ['description']
      },
      handler(params) {
        return { taskId: publishTask({
          description: params.description,
          input: params.input || {},
          initiator: params.initiator || 'ceo',
          priority: params.priority
        })};
      }
    });

    api.registerTool({
      name: 'mteam_claim_task',
      description: '认领任务',
      input: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID' },
          agentId: { type: 'string', description: '认领者agentId' }
        },
        required: ['taskId', 'agentId']
      },
      handler(params) {
        return { claimed: claimTask(params.taskId, params.agentId), taskId: params.taskId };
      }
    });

    api.registerTool({
      name: 'mteam_update_task',
      description: '更新任务状态或心跳',
      input: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID' },
          status: { type: 'string', enum: ['running', 'completed', 'failed', 'pending'], description: '状态（可选，不传则只更新心跳）' },
          summary: { type: 'string', description: '结果摘要' },
          description: { type: 'string', description: '新描述（用于"需下一步"场景）' },
          result: { type: 'object', description: '完整结果', properties: {} },
          lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒），running 时定期更新表示"还活着"' }
        },
        required: ['taskId']
      },
      handler(params) {
        return updateTask(
          params.taskId,
          params.status,
          params.result,
          params.summary,
          params.description,
          params.lastHeartbeatAt
        );
      }
    });

    api.registerTool({
      name: 'mteam_get_pending',
      description: '获取待认领任务列表（agent有进行中任务时返回空）',
      input: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: '过滤：agentId' }
        }
      },
      handler(params) {
        return { pending: getPendingTasks(params.agentId) };
      }
    });

    api.registerTool({
      name: 'mteam_get_agent_active',
      description: '获取 agent 当前进行中的任务（一个 agent 不能同时做多个任务）',
      input: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'agentId' }
        },
        required: ['agentId']
      },
      handler(params) {
        return { activeTask: getAgentActiveTask(params.agentId) };
      }
    });

    api.registerTool({
      name: 'mteam_get_task',
      description: '获取任务详情',
      input: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务ID' }
        },
        required: ['taskId']
      },
      handler(params) {
        return getTask(params.taskId);
      }
    });

    api.registerTool({
      name: 'mteam_get_all_tasks',
      description: '获取所有任务',
      input: { type: 'object', properties: {} },
      handler() {
        return { tasks: getAllTasks() };
      }
    });

    api.logger?.info('[m-team] 任务池协作插件已激活');
    api.logger?.info(`[m-team] Workspace: ${config.workspaceRoot}`);
    api.logger?.info(`[m-team] Tasks: ${getTasksDir()}`);
    api.logger?.info(`[m-team] Queue: ${getQueueDir()}`);
  }
});
