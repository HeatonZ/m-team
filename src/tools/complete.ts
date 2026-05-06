/**
 * mteam_complete_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { completeTask } from '../pool/index.js';
import { formatTaskNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void; warn: (msg: string) => void } | null },
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_complete_task');
  api.registerTool({
    name: 'mteam_complete_task',
    description: 'Executor 完成任务（带通知）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        contextStep: { type: 'string', description: '当前步骤描述（必填，必须说明这一步做了什么）' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
      },
      required: ['taskId', 'contextStep'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const contextStep = readStringParam(rawParams, 'contextStep', { required: true })!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
