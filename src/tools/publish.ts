/**
 * mteam_publish_task
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import type { OpenClawPluginToolContext } from '../types/openclaw-hooks.js';
import { textResult } from './shared.js';
import { publishTask, getTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatPublishNotifications, sendNotifications } from '../notifications.js';
import { PublishTaskParams } from '../types/tools.js';
import type { PublishTaskParamsInterface } from '../types/tools.js';
import {
  TASK_CONTRACT_LIMITS,
  hasDescriptionGoalDrift,
  hasGoalProceduralPattern,
  hasMultiStepPattern,
  sanitizeSingleLine,
} from '../task-contract.js';

function inferPublisher(rawParams: PublishTaskParamsInterface, toolContext?: OpenClawPluginToolContext): string {
  const explicitPublisher = rawParams.publisher?.trim();
  if (explicitPublisher) return explicitPublisher;

  const contextAgentId = toolContext?.agentId?.trim();
  if (contextAgentId) return contextAgentId;

  throw new Error('mteam_publish_task 缺少 publisher');
}

type PublishToolParams = PublishTaskParamsInterface & {
  toolContext?: OpenClawPluginToolContext;
};

function validatePublishTaskInput(input: PublishTaskParamsInterface & { publisher: string }): string[] {
  const errors: string[] = [];
  const goal = sanitizeSingleLine(input.goal);
  const description = sanitizeSingleLine(input.description);

  if (!goal) errors.push('PUBLISH_GOAL_REQUIRED: goal is required.');
  if (!description) errors.push('PUBLISH_DESCRIPTION_REQUIRED: description is required.');
  if (description.length > TASK_CONTRACT_LIMITS.descriptionMaxLength) {
    errors.push('PUBLISH_DESCRIPTION_TOO_LONG: keep description within 120 characters and only describe the current step.');
  }
  if (goal.length > TASK_CONTRACT_LIMITS.goalMaxLength) {
    errors.push('PUBLISH_GOAL_TOO_LONG: keep goal within 200 characters and describe final success only.');
  }
  if (goal === description) {
    errors.push('PUBLISH_GOAL_DESCRIPTION_IDENTICAL: goal and description must not be identical.');
  }

  if (/\r?\n/.test(description)) {
    errors.push('PUBLISH_DESCRIPTION_MULTI_LINE: description must be a single current-step sentence.');
  }

  if (hasMultiStepPattern(description)) {
    errors.push('PUBLISH_DESCRIPTION_MULTI_STEP: description appears multi-step; publish only one baton.');
  }

  if (hasDescriptionGoalDrift(description)) {
    errors.push('PUBLISH_DESCRIPTION_GOAL_DRIFT: description must be current-step work only, not acceptance/closure language.');
  }

  if (hasGoalProceduralPattern(goal)) {
    errors.push('PUBLISH_GOAL_SHOULD_BE_FINAL_STATE: goal should describe final success state, not step-by-step process.');
  }

  return errors;
}

export function register(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: 'Publish task',
    description: 'Publish task into M-Team queue',
    parameters: PublishTaskParams,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as PublishToolParams;
      const toolContext = params.toolContext;
      const publisher = inferPublisher(params, toolContext);

      api.logger?.info?.(`[m-team] publish execute sessionKey=${toolContext?.sessionKey ?? 'missing-session-key'} agentId=${toolContext?.agentId?.trim() ?? 'missing-agent-id'} rawPublisher=${params.publisher?.trim() ?? 'missing'} effectivePublisher=${publisher}`);

      const { description, goal, taskType, priority } = params;
      if (!taskType) {
        throw new Error('mteam_publish_task invalid input:\n- taskType is required.');
      }

      const validationErrors = validatePublishTaskInput({ ...params, publisher });
      if (validationErrors.length) {
        throw new Error(`mteam_publish_task invalid input:\n- ${validationErrors.join('\n- ')}`);
      }

      const taskId = publishTask({
        taskType,
        description,
        goal,
        publisher,
        priority,
      });

      const task = getTask(taskId);
      if (task && config.notifications?.length) {
        try {
          const notifications = formatPublishNotifications(task, config.notifications);
          const traces = await sendNotifications(notifications, api.logger ?? null);
          api.logger?.info?.(`[m-team] publish notifications prepared=${notifications.length} delivered=${traces.filter((trace) => trace.delivered).length} taskId=${taskId}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          api.logger?.warn(`[m-team] publish notifications unexpected failure taskId=${taskId} error=${message}`);
        }
      }

      return textResult(`task published\n${task ? formatTaskAsText(task) : `ID: ${taskId}`}`, { taskId });
    },
  });
}
