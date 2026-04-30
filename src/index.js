/**
 * M-Team 插件 — OpenClaw 多 Agent 任务池编排
 *
 * 目录结构:
 *   src/
 *     pool/           任务池核心（db + operations + 对外 API）
 *     schema/         Task 数据模型与验证
 *     tools/          全部 registerTool 入口
 *     hooks/          生命周期 hook 处理器
 *     index.js        插件入口
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { homedir } from 'node:os';
import { setNotifications } from './notifications.js';
import { registerTools } from './tools/index.js';
import { registerSubagentEndedHook } from './hooks/subagentEnded.js';
import {
  setWorkspaceRoot,
  publishTask,
  claimTask,
  updateTask,
  getPendingTasks,
  getAgentActiveTask,
  getTask,
  getAllTasks,
  cancelTask,
  relinquishTask,
  relayTask,
  completeTask,
  failTask,
  formatTaskNotifications
} from './pool/index.js';
import { TaskStatus, TaskPriority } from './schema/task.js';

// ============================================================
// Plugin entry — 使用 OpenClaw definePluginEntry 格式
// ============================================================

const plugin = definePluginEntry({
  id: 'm-team',
  name: 'M-Team 去中心化任务池',
  description: '去中心化任务池协作插件 — 多Agent任务分发与执行',

  register(api) {
    // 设置 workspace 根目录（OpenClaw 5.x 通过 api.pluginConfig 传递）
    const config = api.pluginConfig ?? {};
    let workspaceRoot = config.workspaceRoot ?? '/mnt/d/code/m-team';
    if (workspaceRoot.startsWith('~')) {
      workspaceRoot = require('node:path').join(homedir(), workspaceRoot.slice(1));
    }
    setWorkspaceRoot(workspaceRoot);

    // 设置通知配置（供 tools 和 hooks 共享）
    setNotifications(config.notifications ?? []);

    // 注册工具
    registerTools(api, config);

    // 注册 subagent_ended hook
    registerSubagentEndedHook(api);

    api.logger?.info('[m-team] 插件加载完成', {
      workspaceRoot,
      tools: [
        'mteam_publish_task',
        'mteam_claim_task',
        'mteam_update_task',
        'mteam_complete_task',
        'mteam_cancel_task',
        'mteam_relay_task',
        'mteam_relinquish_task',
        'mteam_get_pending',
        'mteam_get_agent_active',
        'mteam_get_task',
        'mteam_get_all_tasks'
      ]
    });
  }
});

export default plugin;

// ============================================================
// 重新导出（供内部使用和测试）
// ============================================================

export {
  setWorkspaceRoot,
  publishTask,
  claimTask,
  updateTask,
  getPendingTasks,
  getAgentActiveTask,
  getTask,
  getAllTasks,
  cancelTask,
  relinquishTask,
  relayTask,
  completeTask,
  failTask,
  formatTaskNotifications,
  TaskStatus,
  TaskPriority
};
