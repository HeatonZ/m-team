/**
 * mteam_relay_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { relayTask } from '../pool/index.js';
import { formatRelayNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void; warn: (msg: string) => void } | null },
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_relay_task');
  api.registerTool({
    name: 'mteam_relay_task',
    description: 'Executor 完成当前步骤并交接给下一个 executor（追加 context 记录这一步，然后放回 pending 池子）',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '执行者 agentId' },
        contextStep: { type: 'string', description: '当前步骤描述' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
        description: { type: 'string', description: 'relay 后任务的 description（下一棒看到的内容）' },
      },
      required: ['taskId', 'agentId', 'contextStep', 'description'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;
      const contextStep = readStringParam(rawParams, 'contextStep', { required: true })!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
      const description = readStringParam(rawParams, 'description', { required: true })!;

      const contextEntry = { step: contextStep, output: contextOutput || {} };
      const result = relayTask(taskId, agentId, contextEntry, undefined, description);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatRelayNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult('任务已交接', { success: result.success, task: result.task });
    },
  });
}
