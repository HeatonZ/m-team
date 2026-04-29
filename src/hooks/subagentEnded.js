/**
 * M-Team Hooks — subagent_ended handler
 *
 * executor session 正常/异常结束时自动触发，稳定调用完成任务/失败任务。
 * 不依赖 executor 主动调工具。
 */

import { completeTask, failTask } from '../pool/operations.js';

/**
 * @param {object} api - OpenClaw plugin api
 * @returns {void}
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
      const result = completeTask(taskId);
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记完成 (outcome=${outcome})`);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
    } else {
      const errorMsg = error || reason || outcome;
      const result = failTask(taskId, errorMsg);
      if (result.success) {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 标记失败 (outcome=${outcome}, error=${errorMsg})`);
      } else {
        api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} 无操作 (${result.reason})`);
      }
    }
  });
}
