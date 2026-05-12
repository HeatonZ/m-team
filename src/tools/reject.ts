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
import type { RejectTaskParamsInterface, StepContractInterface } from '../types/tools.js';

/**
 * 从驳回原因中解析出下一步描述。
 * 格式：验收驳回：{问题}。下一步：{描述}
 * 或：验收驳回：{问题}。下一步描述：{描述}
 */
function parseNextDescription(reason: string): string | null {
  // 匹配 "下一步：" 或 "下一步描述：" 后的内容
  const patterns = [
    /下一步描述[：:]\s*(.+)/i,
    /下一步[：:]\s*(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = reason.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function normalizeStepContract(raw: StepContractInterface | undefined): StepContractInterface | undefined {
  if (!raw) return undefined;
  return {
    ...(typeof raw.expectedOutcome === 'string' && raw.expectedOutcome.trim() ? { expectedOutcome: raw.expectedOutcome.trim() } : {}),
    doneWhen: Array.isArray(raw.doneWhen) ? raw.doneWhen.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [],
    ...(Array.isArray(raw.constraints) ? { constraints: raw.constraints.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) } : {}),
    ...(Array.isArray(raw.inputHints) ? { inputHints: raw.inputHints.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) } : {}),
  };
}

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
      const { reason } = rawParams;
      const toolContext = (rawParams as RejectTaskParamsInterface & { toolContext?: OpenClawPluginToolContext }).toolContext;
      const publisher = toolContext?.agentId?.trim();
      if (!publisher) {
        throw new Error('mteam_reject_task missing publisher identity from tool context');
      }

      const nextDescription = parseNextDescription(reason);
      const nextStepContract = normalizeStepContract(rawParams.stepContract);
      const result = rejectTask(taskId, publisher, reason, nextDescription, nextStepContract);
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
