/**
 * mteam_reject_task 工具定义
 * Publisher 验收不通过，将任务打回 pending 池子
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { updateTask } from '../pool/index.js';
import { formatRejectNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void; warn: (msg: string) => void } | null },
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_reject_task');
  api.registerTool({
    name: 'mteam_reject_task',
    description: 'Publisher 验收不通过，驳回任务到 pending 池子（仅 Publisher 使用）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        reason: { type: 'string', description: '驳回原因' },
      },
      required: ['taskId', 'reason'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
      const reason = readStringParam(rawParams, 'reason', { required: true })!;

      const contextEntry = { step: reason, output: {} };
      const task = updateTask(taskId, 'pending', contextEntry, null, null, null);

      // 通知 executor（驳回原因作为最后一步）
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
