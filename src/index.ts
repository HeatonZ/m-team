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
import type { NotificationConfig } from './notifications.js';

// ============================================================
// Plugin entry
// ============================================================

// OpenClaw plugin-sdk plugin-entry 导出类型
declare function definePluginEntry(manifest: {
  id: string;
  name: string;
  description: string;
  register(api: OpenClawPluginApi): void;
}): { default: unknown };

interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
}

interface PluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
}

interface OpenClawPluginApi {
  logger?: Logger;
  pluginConfig?: PluginConfig;
  registerTool(tool: unknown): void;
  on(event: string, handler: (event: Record<string, unknown>) => Promise<void>): void;
  runtime?: {
    subagent?: {
      run(opts: { sessionKey: string; message: string }): Promise<{ runId: string }>;
    };
  };
  config?: {
    accounts?: Array<{ type?: string; provider?: string; id?: string; accountId?: string }>;
  };
  channel?: {
    outbound?: {
      loadAdapter(opts: { channelId: string; accountId?: string }): Promise<{
        sendText(opts: { text: string }): Promise<void>;
      }>;
    };
  };
}

const plugin = definePluginEntry({
  id: 'm-team',
  name: 'M-Team 去中心化任务池',
  description: '去中心化任务池协作插件 — 多Agent任务分发与执行',

  register(api: OpenClawPluginApi) {
    const config = api.pluginConfig ?? {};
    let workspaceRoot = config.workspaceRoot ?? '/mnt/d/code/m-team';
    if (workspaceRoot.startsWith('~')) {
      workspaceRoot = path.join(homedir(), workspaceRoot.slice(1));
    }
    setWorkspaceRoot(workspaceRoot);

    setNotifications(config.notifications ?? []);

    registerTools(api as unknown as import('./tools/index.js').OpenClawApi, config);

    registerSubagentEndedHook(api as unknown as import('./hooks/subagentEnded.js').OpenClawApi);

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
