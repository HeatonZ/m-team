/**
 * mteam_cancel_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool, OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { cancelTask } from '../pool/index.js';
import { formatCancelNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_cancel_task');
  api.registerTool({
    name: 'mteam_cancel_task',
    label: '取消任务',
    description: 'Publisher 取消任务（不可再 relay）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
        reason: { type: 'string', description: '取消原因' },
      },
      required: ['taskId', 'publisher'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const publisher = readStringParam(rawParams, 'publisher', { required: true })!;
      const reason = readStringParam(rawParams, 'reason');

      const result = cancelTask(taskId, publisher, reason);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCancelNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务已取消', { success: result.success, task: result.task });
    },
  });
}
