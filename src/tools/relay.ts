/**
 * mteam_relay_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { relayTask } from '../pool/index.js';
import { formatRelayNotifications } from '../notifications.js';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RelayTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: { notifications?: NotificationConfig[] }
): void {
  api.logger?.info('[m-team] registering mteam_relay_task');
  api.registerTool({
    name: 'mteam_relay_task',
    label: '交接任务',
    description: 'Executor 完成当前步骤并交接给下一个 executor（追加 context 记录这一步，然后放回 pending 池子）',
    parameters: RelayTaskParams,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const agentId = rawParams.agentId as string;
      const contextStep = rawParams.contextStep as string;
      const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
      const description = rawParams.description as string;

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
