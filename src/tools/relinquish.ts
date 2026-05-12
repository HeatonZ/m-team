/**
 * mteam_relinquish_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { getTask, relinquishTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatRelinquishNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RelinquishTaskParams } from '../types/tools.js';
import type { RelinquishTaskParamsInterface } from '../types/tools.js';

const STALE_RUNNING_TASK_TIMEOUT_MS = 60 * 60 * 1000;

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_relinquish_task');
  api.registerTool({
    name: 'mteam_relinquish_task',
    label: '放弃任务',
    description: 'Executor 主动放弃当前任务（放回 pending）',
    parameters: RelinquishTaskParams,
    async execute(_toolCallId: string, rawParams: RelinquishTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { executorId, reason } = rawParams;
      const toolContext = (rawParams as RelinquishTaskParamsInterface & {
        toolContext?: { sessionKey?: string; agentId?: string };
      }).toolContext;
      const isPublisherHeartbeat = Boolean(
        toolContext?.sessionKey?.endsWith(':heartbeat')
        && toolContext?.agentId
        && config.publishers?.includes(toolContext.agentId)
      );

      if (isPublisherHeartbeat) {
        const task = getTask(taskId);
        if (!task) {
          return failedTextResult('TASK_NOT_FOUND', { success: false, reason: 'TASK_NOT_FOUND' });
        }
        if (task.status !== 'running' || !task.executor) {
          return failedTextResult(`TASK_NOT_RUNNING_${task.status}`, { success: false, reason: `TASK_NOT_RUNNING_${task.status}` });
        }
        const staleForMs = Date.now() - task.updatedAt;
        if (staleForMs < STALE_RUNNING_TASK_TIMEOUT_MS) {
          return failedTextResult('TASK_NOT_STALE_ENOUGH_FOR_RELINQUISH', {
            success: false,
            reason: 'TASK_NOT_STALE_ENOUGH_FOR_RELINQUISH',
            staleForMs,
            requiredMs: STALE_RUNNING_TASK_TIMEOUT_MS,
          });
        }
      }

      const result = relinquishTask(taskId, executorId, reason ?? 'executor_relinquish');
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      if (result.success && result.task && config.notifications?.length) {
        try {
          const notifications = formatRelinquishNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      return textResult(`↩️ 任务已放弃\n${result.task ? formatTaskAsText(result.task) : taskId}`, { success: result.success, reason: result.reason, task: result.task });
    },
  });
}
