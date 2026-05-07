/**
 * mteam_complete_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { completeTask } from '../pool/index.js';
import { formatTaskNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { CompleteTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_complete_task');
  api.registerTool({
    name: 'mteam_complete_task',
    label: '完成任务',
    description: 'Executor 完成任务（带通知）',
    parameters: CompleteTaskParams,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const contextStep = rawParams.contextStep as string;
      const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;

      const contextEntry = { step: contextStep, output: contextOutput || {} };
      const result = completeTask(taskId, contextEntry);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatTaskNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务完成', { success: result.success, task: result.task });
    },
  });
}
