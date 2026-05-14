/**
 * mteam_close_task tool definition.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { closeTask, getTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatCloseNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { CloseTaskParams } from '../types/tools.js';
import type { CloseTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig,
): void {
  api.logger?.info('[m-team] registering mteam_close_task');
  api.registerTool({
    name: 'mteam_close_task',
    label: 'Close task',
    description: 'Publisher accepts and closes a completed task',
    parameters: CloseTaskParams,
    async execute(_toolCallId: string, rawParams: CloseTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { publisher } = rawParams;

      const taskBeforeClose = getTask(taskId);
      if (!taskBeforeClose) {
        return failedTextResult('TASK_NOT_FOUND', { success: false, reason: 'TASK_NOT_FOUND' });
      }
      if (taskBeforeClose.status === 'completed') {
        const summary = taskBeforeClose.acceptance?.summary?.trim();
        const files = taskBeforeClose.acceptance?.files ?? [];
        if (!summary || files.length === 0) {
          return failedTextResult('ACCEPTANCE_SNAPSHOT_REQUIRED: completed task must include acceptance.summary and acceptance.files before close', {
            success: false,
            reason: 'ACCEPTANCE_SNAPSHOT_REQUIRED',
          });
        }
      }

      const result = closeTask(taskId, publisher);
      if (!result.success) {
        return failedTextResult(result.reason || 'Operation failed', { success: result.success, reason: result.reason });
      }

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatCloseNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] close notifications failed');
        }
      }

      return textResult(`Task closed\n${result.task ? formatTaskAsText(result.task, { includeGoal: true }) : taskId}`, {
        success: result.success,
        task: result.task,
      });
    },
  });
}
