/**
 * mteam_publish_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { publishTask, getTask } from '../pool/index.js';
import { formatPublishNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: '发布任务',
    description: '发布任务到 M-Team 任务池',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '任务目标（executor 凭此判断任务是否适合自己，必须有区分度，不能只是标题）' },
        description: { type: 'string', description: '当前这一步做什么（每次只写一步，relay 时由上一个 executor 填写下一步）' },
        input: { type: 'object', description: '初始输入数据', additionalProperties: true },
        publisher: { type: 'string', description: '发布者，默认 "user"' },
        priority: { type: 'string', description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] },
      },
      required: ['goal', 'description'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const description = readStringParam(rawParams, 'description', { required: true });
      const goal = readStringParam(rawParams, 'goal', { required: true });
      const publisher = readStringParam(rawParams, 'publisher') ?? 'user';
      const priority = readStringParam(rawParams, 'priority') ?? undefined;

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
