/**
 * M-Team Plugin — 去中心化任务池协作
 * OpenClaw pluginApi: 1.0.0
 *
 * 配置来源：openclaw.json plugins.entries.m-team.config
 */

const path = require('path');

// 默认配置
const DEFAULT_CONFIG = {
  workspaceRoot: null  // 必须从 pluginConfig 传入
};

let config = { ...DEFAULT_CONFIG };

function getWorkspaceRoot() {
  return config.workspaceRoot;
}

function getTasksDir() {
  return path.join(config.workspaceRoot, 'tasks');
}

function getQueueDir() {
  return path.join(config.workspaceRoot, 'queue');
}

// 插件主入口 — OpenClaw 调用 register(api) 加载插件
function register(api) {
  // 从 pluginConfig 读取配置
  const pluginConfig = api.pluginConfig || {};
  config.workspaceRoot = pluginConfig.workspaceRoot || DEFAULT_CONFIG.workspaceRoot;

  if (!config.workspaceRoot) {
    api.logger.warn?.('[m-team] 未配置 workspaceRoot，跳过初始化');
    return;
  }

  // 初始化目录
  const fs = require('fs');
  fs.mkdirSync(config.workspaceRoot, { recursive: true });
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(getQueueDir(), { recursive: true });

  // 初始化 schema 和 queue
  const schema = require(path.join(__dirname, 'schema', 'task.js'));
  const queue = require(path.join(__dirname, 'queue', 'index.js'));
  schema.setWorkspaceRoot(getTasksDir());
  queue.setWorkspaceRoot(config.workspaceRoot);

  // 注册工具
  api.registerTool({
    name: 'mteam_publish_task',
    description: '发布任务到队列',
    input: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '任务描述' },
        requiredCapability: { type: 'string', enum: ['captain', 'maker', 'scholar', 'general'], description: '所需能力' },
        input: { type: 'object', description: '任务输入参数' },
        initiator: { type: 'string', description: '发起者' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'], description: '优先级，默认 normal' }
      },
      required: ['description', 'requiredCapability']
    },
    handler: async (params) => {
      const taskId = queue.publishTask({
        description: params.description,
        requiredCapability: params.requiredCapability,
        input: params.input || {},
        initiator: params.initiator || 'ceo',
        priority: params.priority
      });
      return { taskId };
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
    handler: async (params) => {
      const claimed = queue.claimTask(params.taskId, params.agentId);
      return { claimed, taskId: params.taskId };
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
        result: { type: 'object', description: '完整结果' },
        lastHeartbeatAt: { type: 'number', description: '心跳时间戳（毫秒），running 时定期更新表示"还活着"' }
      },
      required: ['taskId']
    },
    handler: async (params) => {
      const task = queue.updateTask(
        params.taskId,
        params.status,
        params.result,
        params.summary,
        params.description,
        params.lastHeartbeatAt
      );
      return task;
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
    handler: async (params) => {
      const pending = queue.getPendingTasks(params.agentId);
      return { pending };
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
    handler: async (params) => {
      const task = queue.getAgentActiveTask(params.agentId);
      return { activeTask: task };
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
    handler: async (params) => {
      const task = queue.getTask(params.taskId);
      return task;
    }
  });

  api.registerTool({
    name: 'mteam_get_all_tasks',
    description: '获取所有任务',
    input: { type: 'object', properties: {} },
    handler: async () => {
      const tasks = queue.getAllTasks();
      return { tasks };
    }
  });

  api.logger.info?.('[m-team] 任务池协作插件已激活');
  api.logger.info?.(`[m-team] Workspace: ${config.workspaceRoot}`);
  api.logger.info?.(`[m-team] Tasks: ${getTasksDir()}`);
  api.logger.info?.(`[m-team] Queue: ${getQueueDir()}`);
}

module.exports = { register };
