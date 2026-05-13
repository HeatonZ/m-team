/**
 * mteam_reject_task 工具定义
 * Publisher 验收不通过，将任务打回 pending 池子
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

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_reject_task');
  api.registerTool({
    name: 'mteam_reject_task',
    label: '驳回任务',
    description: 'Publisher 验收不通过，驳回任务到 pending 池子（仅 Publisher 使用）',
    parameters: RejectTaskParams,
    async execute(_toolCallId: string, rawParams: RejectTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { reason, description } = rawParams;
      const toolContext = (rawParams as RejectTaskParamsInterface & { toolContext?: OpenClawPluginToolContext }).toolContext;
      const publisher = toolContext?.agentId?.trim();
      if (!publisher) {
        throw new Error('mteam_reject_task missing publisher identity from tool context');
      }

      const nextDescription = description.trim();
      const result = rejectTask(taskId, publisher, reason, nextDescription);
      if (!result.success) {
        return textResult(`❌ reject failed: ${result.reason}`, { success: false, reason: result.reason });
      }
      const task = result.task;

      if (config.notifications?.length && task) {
        try {
          const notifications = formatRejectNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 驳回通知发送失败');
        }
      }

      return textResult(`🔁 任务已驳回\n${task ? formatTaskAsText(task, { includeGoal: true }) : `任务 ${taskId}`}`, { task });
    },
  });
}
