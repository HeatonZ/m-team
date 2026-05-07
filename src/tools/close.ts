/**
 * mteam_close_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { closeTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatCloseNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { CloseTaskParams } from '../types/tools.js';
import type { CloseTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_close_task');
  api.registerTool({
    name: 'mteam_close_task',
    label: '验收关闭',
    description: 'Publisher 验收通过，关闭任务（终态）',
    parameters: CloseTaskParams,
    async execute(_toolCallId: string, rawParams: CloseTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { publisher } = rawParams;

      const result = closeTask(taskId, publisher);
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCloseNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`🔒 任务已关闭\n${result.task ? formatTaskAsText(result.task) : taskId}`, { success: result.success, task: result.task });
    },
  });
}
