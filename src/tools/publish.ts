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
import type { PublishTaskParamsInterface, StepContractInterface } from '../types/tools.js';

function inferPublisher(rawParams: PublishTaskParamsInterface, toolContext?: OpenClawPluginToolContext): string {
  const explicitPublisher = rawParams.publisher?.trim();
  if (explicitPublisher) return explicitPublisher;

  const contextAgentId = toolContext?.agentId?.trim();
  if (contextAgentId) return contextAgentId;

  throw new Error('mteam_publish_task \u7f3a\u5c11 publisher');
}

type PublishToolParams = PublishTaskParamsInterface & {
  toolContext?: OpenClawPluginToolContext;
};

function normalizeLineList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function normalizeStepContract(raw: StepContractInterface | undefined): StepContractInterface | undefined {
  if (!raw) return undefined;
  return {
    ...(typeof raw.expectedOutcome === 'string' && raw.expectedOutcome.trim() ? { expectedOutcome: raw.expectedOutcome.trim() } : {}),
    doneWhen: normalizeLineList(raw.doneWhen) ?? [],
    ...(normalizeLineList(raw.constraints) ? { constraints: normalizeLineList(raw.constraints) } : {}),
    ...(normalizeLineList(raw.inputHints) ? { inputHints: normalizeLineList(raw.inputHints) } : {}),
  };
}

function validatePublishTaskInput(input: PublishTaskParamsInterface & { publisher: string }): string[] {
  const errors: string[] = [];
  const goal = input.goal.trim();
  const description = input.description.trim();
  const stepContract = normalizeStepContract(input.stepContract);

  if (!goal) errors.push('goal is required.');
  if (!description) errors.push('description is required.');
  if (description.length > 120) errors.push('description is too long; keep it within 120 characters and only describe the current step.');
  if (goal.length > 200) errors.push('goal is too long; keep it within 200 characters and only describe final success.');
  if (goal === description) errors.push('goal and description must not be identical.');

  if (!stepContract) {
    return errors;
  }
  if (stepContract.expectedOutcome !== undefined && !stepContract.expectedOutcome.trim()) errors.push('stepContract.expectedOutcome must not be empty when provided.');
  if (stepContract.doneWhen.length === 0) errors.push('stepContract.doneWhen must contain at least one completion rule.');
  if (stepContract.doneWhen.length > 4) errors.push('stepContract.doneWhen must contain at most four rules.');

  return errors;
}

export function register(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: '\u53d1\u5e03\u4efb\u52a1',
    description: '\u53d1\u5e03\u4efb\u52a1\u5230 M-Team \u4efb\u52a1\u6c60',
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
      const stepContract = normalizeStepContract(params.stepContract);
      const validationErrors = validatePublishTaskInput({ ...params, publisher, stepContract });
      if (validationErrors.length) {
        throw new Error(`mteam_publish_task invalid input:\n- ${validationErrors.join('\n- ')}`);
      }

      const taskId = publishTask({
        taskType,
        description,
        goal,
        stepContract,
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

      return textResult(`\u2705 task published\n${task ? formatTaskAsText(task) : `ID: ${taskId}`}`, { taskId });
    },
  });
}
