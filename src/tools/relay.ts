/**
 * mteam_relay_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { ContextStepInput, relayTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatRelayNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RelayTaskParams } from '../types/tools.js';
import type { RelayTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_relay_task');
  api.registerTool({
    name: 'mteam_relay_task',
    label: '交接任务',
    description: 'Executor 完成当前步骤并交接给下一个 executor（追加 context 记录这一步，然后放回 pending 池子）',
    parameters: RelayTaskParams,
    async execute(_toolCallId: string, rawParams: RelayTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { agentId, contextStep, contextOutput, description } = rawParams;

      const contextEntry: ContextStepInput = { step: contextStep, output: contextOutput || {} };
      const result = relayTask(taskId, agentId, contextEntry, description);
      if (!result.success) return failedTextResult(result.reason|| '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatRelayNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`🔄 任务已交接\n${result.task ? formatTaskAsText(result.task) : taskId}`, { success: result.success, task: result.task });
    },
  });
}
