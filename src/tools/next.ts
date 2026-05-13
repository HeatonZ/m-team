/**
 * mteam_next_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { nextTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatNextNotifications, sendNotifications } from '../notifications.js';
import { NextTaskParams } from '../types/tools.js';
import type { NextTaskParamsInterface } from '../types/tools.js';
import { VALID_TASK_TYPES, type TaskType } from '../schema/task.js';

function normalizeContextOutput(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return undefined;
}

function normalizeTaskType(raw: string | undefined): TaskType | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  return VALID_TASK_TYPES.includes(value as TaskType) ? (value as TaskType) : undefined;
}

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_next_task');
  api.registerTool({
    name: 'mteam_next_task',
    label: '推进到下一步',
    description: '结束当前一棒并生成下一步 description，任务回到 pending 池子',
    parameters: NextTaskParams,
    async execute(_toolCallId: string, rawParams: NextTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { agentId, contextStep, contextOutput, description, nextTaskType } = rawParams;
      const normalizedContextOutput = normalizeContextOutput(contextOutput) ?? {};
      const normalizedNextTaskType = normalizeTaskType(nextTaskType);

      const result = nextTask(taskId, agentId, { step: contextStep, output: normalizedContextOutput }, description, normalizedNextTaskType);
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatNextNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`🔄 已生成下一步并放回任务池\n${result.task ? formatTaskAsText(result.task) : taskId}`, {
        success: result.success,
        task: result.task,
      });
    },
  });
}
