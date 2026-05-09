/**
 * mteam_publish_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult } from './shared.js';
import { publishTask, getTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatPublishNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { PublishTaskParams } from '../types/tools.js';
import type { PublishTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: '发布任务',
    description: '发布任务到 M-Team 任务池',
    parameters: PublishTaskParams,
    async execute(_toolCallId: string, rawParams: PublishTaskParamsInterface) {
      const { description, goal, publisher = 'user', priority } = rawParams;

      const taskId = publishTask({
        description,
        goal,
        publisher,
        priority,
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

      return textResult(`✅ 任务发布成功\n${task ? formatTaskAsText(task) : `ID: ${taskId}`}`, { taskId });
    },
  });
}
