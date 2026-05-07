/**
 * mteam_reject_task 工具定义
 * Publisher 验收不通过，将任务打回 pending 池子
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, readTaskId } from './shared.js';
import { updateTask } from '../pool/index.js';
import { formatRejectNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RejectTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_reject_task');
  api.registerTool({
    name: 'mteam_reject_task',
    label: '驳回任务',
    description: 'Publisher 验收不通过，驳回任务到 pending 池子（仅 Publisher 使用）',
    parameters: RejectTaskParams,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const reason = rawParams.reason as string;

      const contextEntry = { step: reason, output: {} };
      const task = updateTask(taskId, 'pending', contextEntry, null, null, null);

      if (config.notifications?.length && task) {
        try {
          const notifications = formatRejectNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 驳回通知发送失败');
        }
      }

      return textResult('任务已驳回', { task });
    },
  });
}
