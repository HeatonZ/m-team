/**
 * M-Team Hooks — subagent_ended handler
 *
 * executor session 正常/异常结束时自动触发，标记任务完成/失败并发送通知。
 */

import type {
  OpenClawPluginApi,
  PluginHookSubagentEndedEvent,
} from 'openclaw/plugin-sdk/core';
import { failTask } from '../pool/operations.js';

export function registerSubagentEndedHook(api: OpenClawPluginApi): void {
  api.on('subagent_ended', async (event: PluginHookSubagentEndedEvent) => {
    const { targetSessionKey, outcome, reason, error } = event;

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
      // executor 已通过 relay_task 或 complete_task 自行处理任务状态，
      // subagent_ended 只负责 log，不重复调用 completeTask/failTask
      // （relay 后任务已是 PENDING，completeTask 会因状态不是 RUNNING 而失败；
      //  但即调用成功，executor 已写的 context step 也会被覆盖）
      api.logger?.info(`[m-team] subagent_ended: 任务 ${taskId} executor 已处理 (outcome=${outcome})`);
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
