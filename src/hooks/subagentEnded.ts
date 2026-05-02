/**
 * M-Team Hooks — subagent_ended handler
 *
 * executor session 正常/异常结束时自动触发，标记任务完成/失败并发送通知。
 */

import { completeTask, failTask } from '../pool/operations.js';
import { getNotifications, formatTaskNotifications, sendNotifications } from '../notifications.js';

// ============================================================
// OpenClaw Plugin API 子集（内联，无外部依赖）
// ============================================================

interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
}

export interface OpenClawApi {
  logger?: Logger;
  on(event: string, handler: (event: SubagentEndedEvent) => Promise<void>): void;
}

interface SubagentEndedEvent {
  targetSessionKey: string;
  outcome: string;
  reason?: string;
  error?: string;
}

// ============================================================

export function registerSubagentEndedHook(api: OpenClawApi): void {
  api.on('subagent_ended', async (event: SubagentEndedEvent) => {
    const { targetSessionKey, outcome, reason, error } = event;

    // 只处理 agent:<agentId>:m-team:<taskId> 格式的 session
    if (!targetSessionKey?.startsWith('agent:')) return;
    if (!targetSessionKey?.includes(':m-team:')) return;

    // sessionKey 格式: agent:{agentId}:m-team:{taskId}
    const parts = targetSessionKey.split(':');
    // parts[0]=agent, parts[1]=agentId, parts[2]=m-team, parts[3]=taskId
    const taskId = parts[3];
    if (!taskId) {
      api.logger?.warn('[m-team] subagent_ended 解析 taskId 失败', { targetSessionKey });
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
