/**
 * mteam_relinquish_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { relinquishTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatRelinquishNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RelinquishTaskParams } from '../types/tools.js';
import type { RelinquishTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_relinquish_task');
  api.registerTool({
    name: 'mteam_relinquish_task',
    label: '放弃任务',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: RelinquishTaskParams,
    async execute(_toolCallId: string, rawParams: RelinquishTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { executorId, reason } = rawParams;

      const result = relinquishTask(taskId, executorId, reason ?? 'executor_relinquish');
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      if (result.success && result.task && config.notifications?.length) {
        try {
          const notifications = formatRelinquishNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`↩️ 任务已放弃\n${result.task ? formatTaskAsText(result.task) : taskId}`, { success: result.success, reason: result.reason, task: result.task });
    },
  });
}
