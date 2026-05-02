/**
 * M-Team Hooks — subagent_ended handler
 *
 * executor session 正常/异常结束时自动触发，标记任务完成/失败并发送通知。
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { completeTask, failTask } from '../pool/operations.js';
import { getNotifications, formatTaskNotifications, sendNotifications } from '../notifications.js';

// Re-export for backward compatibility with index.ts casts
export {};

/** SDK 类型：OpenClawPluginApi (registerTools 参数) */

// Local event type — mirrors SDK PluginHookSubagentEndedEvent shape (not in SDK public export)
interface SubagentEndedEvent {
  targetSessionKey: string;
  outcome: string;
  reason?: string;
  error?: string;
}

// ============================================================

export function registerSubagentEndedHook(api: OpenClawPluginApi): void {
  api.on('subagent_ended', async (event: unknown) => {
    const { targetSessionKey, outcome, reason, error } = event as SubagentEndedEvent;

    // 只处理 agent:<agentId>:m-team:<taskId> 格式的 session
    if (!targetSessionKey?.startsWith('agent:')) return;
    if (!targetSessionKey?.includes(':m-team:')) return;

    // sessionKey 格式: agent:{agentId}:m-team:{taskId}
    const parts = targetSessionKey.split(':');
    // parts[0]=agent, parts[1]=agentId, parts[2]=m-team, parts[3]=taskId
    const taskId = parts[3];
    if (!taskId) {
      api.logger?.warn('[m-team] subagent_ended 解析 taskId 失败');
      return;
    }

    // outcome=ok|reset → 完成；其他 → 失败
    const isOk = outcome === 'ok' || outcome === 'reset';

    if (isOk) {
      const result = completeTask(taskId, null, { outcome, error: error || undefined });
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记完成 (outcome=${outcome})`);
        const notifications = formatTaskNotifications(result.task!, getNotifications());
        await sendNotifications(notifications, api.logger);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
    } else {
      const errorMsg = error || reason || outcome;
      const result = failTask(taskId, errorMsg ?? undefined, undefined, { outcome, error: errorMsg });
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记失败 (outcome=${outcome}, error=${errorMsg})`);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
      // 失败不发通知
    }
  });
}
