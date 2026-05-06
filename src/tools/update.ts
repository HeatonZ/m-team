/**
 * mteam_update_task 工具定义
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { AnyAgentTool } from 'openclaw/plugin-sdk';
import { textResult } from './shared.js';
import { updateTask } from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';
import { formatRejectNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

export function register(
  api: { registerTool: (tool: AnyAgentTool) => void; logger: { info: (msg: string) => void; warn: (msg: string) => void } | null },
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_update_task');
  api.registerTool({
    name: 'mteam_update_task',
    description: '更新任务状态或追加步骤到 context',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务ID' },
        agentId: { type: 'string', description: '执行者 agentId（追加 context 时必填）' },
        status: { type: 'string', description: '状态', enum: ['running', 'completed', 'failed', 'pending', 'cancelled'] },
        contextStep: { type: 'string', description: '当前步骤描述' },
        contextOutput: {
          type: 'object',
          description: '步骤输出',
          properties: {
            summary: { type: 'string', description: '步骤摘要' },
            files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
          },
        },
        description: { type: 'string', description: '更新当前步骤描述（下一步做什么）' },
      },
      required: ['taskId'],
    } as AnyAgentTool['parameters'],
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
      const agentId = readStringParam(rawParams, 'agentId');
      const status = readStringParam(rawParams, 'status');
      const contextStep = readStringParam(rawParams, 'contextStep');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contextOutput = rawParams.contextOutput as { summary?: string; files?: string } | undefined;
      const description = readStringParam(rawParams, 'description');

      if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
        throw new Error(`Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}`);
      }

      const contextEntry = contextStep
        ? { step: contextStep, output: contextOutput || {} }
        : null;

      const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, null, agentId ?? null);

      // 发送通知：reject（驳回→pending）单独处理
      if (config.notifications?.length && task) {
        const isReject = status === 'pending' && contextStep?.includes('驳回');
        if (isReject) {
          try {
            const notifications = formatRejectNotifications(task, config.notifications);
            await sendNotifications(notifications, api.logger ?? null);
          } catch (e) {
            api.logger?.warn('[m-team] 通知发送失败');
          }
        }
      }

      return textResult('任务更新成功', { task });
    },
  });
}
