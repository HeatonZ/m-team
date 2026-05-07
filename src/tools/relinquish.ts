/**
 * mteam_relinquish_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { relinquishTask } from '../pool/index.js';
import { formatRelinquishNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_relinquish_task');
  api.registerTool({
    name: 'mteam_relinquish_task',
    label: '放弃任务',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        executorId: { type: 'string', description: '执行者 agentId' },
        reason: { type: 'string', description: '放弃原因（会在 context step 中记录）' },
      },
      required: ['taskId', 'executorId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const executorId = readStringParam(rawParams, 'executorId', { required: true })!;
      const reason = readStringParam(rawParams, 'reason') ?? 'executor_relinquish';

      const result = relinquishTask(taskId, executorId, reason);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

      if (result.success && result.task && config.notifications?.length) {
        try {
          const notifications = formatRelinquishNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务已放弃', { success: result.success, reason: result.reason, task: result.task });
    },
  });
}
