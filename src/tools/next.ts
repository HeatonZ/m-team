/**
 * mteam_next_task tool definition.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import type { OpenClawPluginToolContext } from '../types/openclaw-hooks.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { nextTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatNextNotifications, sendNotifications } from '../notifications.js';
import { NextTaskParams } from '../types/tools.js';
import type { NextTaskParamsInterface } from '../types/tools.js';
import { VALID_TASK_TYPES, type TaskType } from '../schema/task.js';
import { resolveAgentIdFromContext } from '../identity.js';

type NextToolParams = Partial<NextTaskParamsInterface> & {
  toolContext?: OpenClawPluginToolContext;
};

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
  config: MTeamPluginConfig,
): void {
  api.logger?.info('[m-team] registering mteam_next_task');
  api.registerTool({
    name: 'mteam_next_task',
    label: 'Move to next step',
    description: 'Finish current step, set next step description, and return task to pending',
    parameters: NextTaskParams,
    async execute(_toolCallId: string, rawParams: NextToolParams) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const agentId = rawParams.agentId?.trim()
        ?? resolveAgentIdFromContext({
          agentId: rawParams.toolContext?.agentId,
          sessionKey: rawParams.toolContext?.sessionKey,
        });
      const { contextStep, contextOutput, description, nextTaskType } = rawParams;
      if (!agentId) {
        return failedTextResult('AGENT_ID_REQUIRED: provide agentId or use a sessionKey that contains agent identity', {
          success: false,
          reason: 'AGENT_ID_REQUIRED',
        });
      }
      if (!contextStep || !description) {
        return failedTextResult('INVALID_INPUT: contextStep and description are required', {
          success: false,
          reason: 'INVALID_INPUT',
        });
      }
      const normalizedContextOutput = normalizeContextOutput(contextOutput) ?? {};
      const normalizedNextTaskType = normalizeTaskType(nextTaskType);

      const result = nextTask(
        taskId,
        agentId,
        { step: contextStep, output: normalizedContextOutput },
        description,
        normalizedNextTaskType,
      );
      if (!result.success) {
        return failedTextResult(result.reason || 'Operation failed', { success: result.success, reason: result.reason });
      }

      if (result.task && config.notifications?.length) {
        try {
          const notifications = formatNextNotifications(result.task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] next notifications failed');
        }
      }

      return textResult(`Next step created and task returned to pending\n${result.task ? formatTaskAsText(result.task) : taskId}`, {
        success: result.success,
        task: result.task,
      });
    },
  });
}
