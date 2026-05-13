/**
 * mteam_reject_task tool definition.
 * Publisher rejects acceptance and sends task back to pending.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, readTaskId } from './shared.js';
import type { OpenClawPluginToolContext } from '../types/openclaw-hooks.js';
import { rejectTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatRejectNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RejectTaskParams } from '../types/tools.js';
import type { RejectTaskParamsInterface } from '../types/tools.js';
import { hasDescriptionGoalDrift, hasMultiStepPattern, sanitizeSingleLine } from '../task-contract.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig,
): void {
  api.logger?.info('[m-team] registering mteam_reject_task');
  api.registerTool({
    name: 'mteam_reject_task',
    label: 'Reject task',
    description: 'Publisher rejects a completed task and sets the next step',
    parameters: RejectTaskParams,
    async execute(_toolCallId: string, rawParams: RejectTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { reason, description } = rawParams;
      const toolContext = (rawParams as RejectTaskParamsInterface & { toolContext?: OpenClawPluginToolContext }).toolContext;
      const publisher = toolContext?.agentId?.trim();
      if (!publisher) {
        throw new Error('mteam_reject_task missing publisher identity from tool context');
      }

      const nextDescription = sanitizeSingleLine(description);
      if (!nextDescription) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_REQUIRED: description is required.');
      }
      if (hasMultiStepPattern(nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_MULTI_STEP: description must be one current baton.');
      }
      if (hasDescriptionGoalDrift(nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_GOAL_DRIFT: description must be current-step work only.');
      }
      const result = rejectTask(taskId, publisher, reason, nextDescription);
      if (!result.success) {
        return textResult(`reject failed: ${result.reason}`, { success: false, reason: result.reason });
      }
      const task = result.task;

      if (config.notifications?.length && task) {
        try {
          const notifications = formatRejectNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] reject notifications failed');
        }
      }

      return textResult(`任务已驳回\n${task ? formatTaskAsText(task, { includeGoal: true }) : `Task ${taskId}`}`, { task });
    },
  });
}
