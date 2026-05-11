/**
 * mteam_cancel_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { cancelTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatCancelNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { CancelTaskParams } from '../types/tools.js';
import type { CancelTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_cancel_task');
  api.registerTool({
    name: 'mteam_cancel_task',
    label: '取消任务',
    description: 'Publisher 取消任务（取消后不可再进入下一步）',
    parameters: CancelTaskParams,
    async execute(_toolCallId: string, rawParams: CancelTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { publisher, reason } = rawParams;

      const result = cancelTask(taskId, publisher, reason);
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCancelNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`🚫 任务已取消\n${result.task ? formatTaskAsText(result.task) : taskId}`, { success: result.success, task: result.task });
    },
  });
}
