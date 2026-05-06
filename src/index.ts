/**
 * M-Team 插件 — OpenClaw 多 Agent 任务池编排
 *
 * 目录结构:
 *   src/
 *     pool/           任务池核心（db + operations + 对外 API）
 *     schema/         Task 数据模型与验证
 *     tools/          全部 registerTool 入口
 *     hooks/          生命周期 hook 处理器
 *     index.ts        插件入口
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { setNotifications } from './notifications.js';
import { registerTools } from './tools/index.js';
import { registerSubagentEndedHook } from './hooks/subagentEnded.js';
import { registerHeartbeatPromptContributionHook } from './hooks/heartbeatPromptContribution.js';
import { registerSessionGuardHook } from './hooks/sessionGuard.js';
import { registerAfterToolCallHook } from './hooks/afterToolCall.js';
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
  failTask
} from './pool/index.js';
import { TaskStatus, TaskPriority } from './schema/task.js';
import type { NotificationConfig } from './notifications.js';

// ============================================================
// Plugin entry
// ============================================================

import { startDashboard, registerDashboardCleanup, stopDashboard } from './dashboard.js';
import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/plugin-entry';
import type {
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
} from 'openclaw/plugin-sdk/core';

interface PluginConfig {
  workspaceRoot?: string;
  executors?: string[];
  publishers?: string[];
  notifications?: NotificationConfig[];
}

const plugin = definePluginEntry({
  id: 'm-team',
  name: 'M-Team 去中心化任务池',
  description: '去中心化任务池协作插件 — 多Agent任务分发与执行',
  configSchema: emptyPluginConfigSchema(),
  contracts: {
    tools: [
      'mteam_publish_task',
      'mteam_claim_task',
      'mteam_update_task',
      'mteam_complete_task',
      'mteam_relay_task',
      'mteam_relinquish_task',
      'mteam_get_task',
      'mteam_get_pending',
      'mteam_cancel_task',
      'mteam_get_agent_active',
      'mteam_get_all_tasks',
      'mteam_close_task',
    ]
  },

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig ?? {}) as PluginConfig;
    let workspaceRoot = config.workspaceRoot ?? '/mnt/d/code/m-team';
    if (workspaceRoot.startsWith('~')) {
      workspaceRoot = path.join(homedir(), workspaceRoot.slice(1));
    }
    setWorkspaceRoot(workspaceRoot);

    setNotifications(config.notifications ?? []);

    // — 启动 dashboard UI（在插件进程内 spawn，随插件卸载而停止）—
    startDashboard(workspaceRoot);
    registerDashboardCleanup(api, stopDashboard);

    registerTools(api, config);

    registerSubagentEndedHook(api);
    registerAfterToolCallHook(api);
    registerHeartbeatPromptContributionHook(api, {
      executors: config.executors ?? ['maker', 'fixer', 'scholar', 'captain'],
      publishers: config.publishers ?? [],
    });
    registerSessionGuardHook(api);

    api.logger?.info('[m-team] 插件加载完成');
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
  TaskStatus,
  TaskPriority
};
