/**
 * mteam_cancel_task tool definition.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { cancelTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatCancelNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { CancelTaskParams } from '../types/tools.js';
import type { CancelTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig,
): void {
  api.logger?.info('[m-team] registering mteam_cancel_task');
  api.registerTool({
    name: 'mteam_cancel_task',
    label: 'Cancel task',
    description: 'Publisher cancels a task',
    parameters: CancelTaskParams,
    async execute(_toolCallId: string, rawParams: CancelTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { publisher, reason } = rawParams;

      const result = cancelTask(taskId, publisher, reason);
      if (!result.success) {
        return failedTextResult(result.reason || 'Operation failed', { success: result.success, reason: result.reason });
      }

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCancelNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] cancel notifications failed');
        }
      }

      return textResult(`Task cancelled\n${result.task ? formatTaskAsText(result.task) : taskId}`, {
        success: result.success,
        task: result.task,
      });
    },
  });
}
