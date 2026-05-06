/**
 * mteam_close_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { closeTask } from '../pool/index.js';
import { formatCloseNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void; warn: (msg: string) => void } | null },
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_close_task');
  api.registerTool({
    name: 'mteam_close_task',
    description: 'Publisher 验收通过，关闭任务（终态）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
      },
      required: ['taskId', 'publisher'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const publisher = readStringParam(rawParams, 'publisher', { required: true })!;

      const result = closeTask(taskId, publisher);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCloseNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务已关闭', { success: result.success, task: result.task });
    },
  });
}
