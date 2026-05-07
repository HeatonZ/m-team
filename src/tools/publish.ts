/**
 * mteam_publish_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { publishTask, getTask } from '../pool/index.js';
import { formatPublishNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { PublishTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: '发布任务',
    description: '发布任务到 M-Team 任务池',
    parameters: PublishTaskParams,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const description = rawParams.description as string | undefined;
      const goal = rawParams.goal as string | undefined;
      const publisher = (rawParams.publisher as string | undefined) ?? 'user';
      const priority = rawParams.priority as string | undefined;

      const taskId = publishTask({
        description: description!,
        goal: goal!,
        input: rawParams.input as Record<string, unknown> | undefined,
        publisher,
        priority: priority ?? undefined,
      });

      const task = getTask(taskId);
      if (task && config.notifications?.length) {
        try {
          const notifications = formatPublishNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务发布成功', { taskId });
    },
  });
}
