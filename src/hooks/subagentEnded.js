/**
 * M-Team Hooks — subagent_ended handler
 *
 * executor session 正常/异常结束时自动触发，标记任务完成/失败并发送通知。
 */

import { completeTask, failTask } from '../pool/operations.js';
import { getNotifications, formatTaskNotifications, sendNotifications } from '../notifications.js';

/**
 * @param {object} api - OpenClaw plugin api
 */
export function registerSubagentEndedHook(api) {
  api.on('subagent_ended', async (event) => {
    const { targetSessionKey, outcome, reason, error } = event;

    // 只处理 mteam: 前缀的 session
    if (!targetSessionKey?.startsWith('mteam:')) return;

    // sessionKey 格式: mteam:{taskId}:{agentId}:{timestamp}
    const parts = targetSessionKey.split(':');
    const taskId = parts[1];
    if (!taskId) {
      api.logger?.warn('[m-team] subagent_ended 解析 taskId 失败', { targetSessionKey });
      return;
    }

    // outcome=ok|reset → 完成；其他 → 失败
    const isOk = outcome === 'ok' || outcome === 'reset';

    if (isOk) {
      const result = completeTask(taskId, null, { outcome, error: error || null });
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记完成 (outcome=${outcome})`);
        const notifications = formatTaskNotifications(result.task, getNotifications());
        await sendNotifications(notifications, api);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
    } else {
      const errorMsg = error || reason || outcome;
      const result = failTask(taskId, errorMsg, null, { outcome, error: errorMsg });
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记失败 (outcome=${outcome}, error=${errorMsg})`);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
      // 失败不发通知
    }
  });
}
