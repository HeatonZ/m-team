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

const ACTION_WORDS = [
  '\u8ba1\u7b97', '\u6574\u7406', '\u8865\u9f50', '\u8f93\u51fa', '\u751f\u6210', '\u7f16\u5199', '\u66f4\u65b0', '\u4fee\u590d', '\u9a8c\u8bc1', '\u68c0\u67e5', '\u6536\u96c6', '\u63d0\u53d6', '\u6c47\u603b', '\u5206\u6790', '\u5bf9\u6bd4', '\u5b9e\u73b0', '\u8fd0\u884c', '\u8bb0\u5f55', '\u590d\u6838', '\u641c\u7d22', '\u521b\u5efa', '\u5904\u7406',
  'compute', 'draft', 'generate', 'write', 'update', 'fix', 'verify', 'check', 'collect', 'extract', 'summarize', 'analyze', 'compare', 'implement', 'run', 'record', 'review', 'search', 'create', 'process',
];
const SUBJECTIVE_WORDS = ['\u5408\u7406\u5373\u53ef', '\u5c3d\u91cf', '\u9002\u5f53', '\u5904\u7406\u5b8c\u6210', '\u5b8c\u5584\u5373\u53ef', 'good enough', 'best effort'];
const FLOW_WORDS = ['\u7b49\u5f85publisher', '\u7b49\u5f85manager', 'close_task', '\u5173\u95ed\u4efb\u52a1', '\u9a8c\u6536\u5173\u95ed', 'wait for publisher', 'close the task'];
const FLOW_SEQUENCE_WORDS = ['\u7136\u540e', '\u63a5\u7740', '\u6700\u540e', '\u5e76\u7ee7\u7eed', '\u518d\u53bb', '\u4e4b\u540e\u518d', 'then', 'next', 'finally', 'after that'];
const GOAL_FLOW_WORDS = ['\u5f53\u524d\u6b65\u9aa4', '\u4e0b\u4e00\u6b65', '\u5173\u95ed', '\u9a8c\u6536', 'close', 'acceptance'];

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

function containsAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some(word => lower.includes(word.toLowerCase()));
}

function countAny(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.filter(word => lower.includes(word.toLowerCase())).length;
}

function buildDefaultStepContract(description: string): StepContractInterface {
  return {
    expectedOutcome: `Achieve the intended result of this current step: ${description}`,
    doneWhen: [
      `Completed the current step: ${description}`,
      'Produced at least one verifiable output or step summary',
    ],
    constraints: [
      'Only execute the current step',
      'Do not expand into a whole-task plan',
    ],
  };
}

function validatePublishTaskInput(input: PublishTaskParamsInterface & { publisher: string }): string[] {
  const errors: string[] = [];
  const goal = input.goal.trim();
  const description = input.description.trim();
  const stepContract = normalizeStepContract(input.stepContract);

  if (description.length > 120) errors.push('description is too long; keep it within 120 characters and only describe the current step.');
  if (goal.length > 200) errors.push('goal is too long; keep it within 200 characters and only describe final success.');
  if (!containsAny(description, ACTION_WORDS)) errors.push('description needs a concrete action verb.');
  if (countAny(description, FLOW_SEQUENCE_WORDS) >= 2) errors.push('description looks multi-step; split it into one current step.');
  if (containsAny(description, FLOW_WORDS)) errors.push('description must not contain publisher close / acceptance flow control.');
  if (containsAny(goal, GOAL_FLOW_WORDS)) errors.push('goal must describe final success, not step flow or close/acceptance.');
  if (goal === description) errors.push('goal and description must not be identical.');

  if (!stepContract) {
    return errors;
  }
  if (stepContract.expectedOutcome !== undefined && !stepContract.expectedOutcome.trim()) errors.push('stepContract.expectedOutcome must not be empty when provided.');
  if (stepContract.doneWhen.length === 0) errors.push('stepContract.doneWhen must contain at least one completion rule.');
  if (stepContract.doneWhen.length > 4) errors.push('stepContract.doneWhen must contain at most four rules.');
  if (stepContract.doneWhen.some(item => containsAny(item, SUBJECTIVE_WORDS))) {
    errors.push('stepContract.doneWhen must be verifiable and not subjective.');
  }
  if (stepContract.constraints?.some(item => containsAny(item, FLOW_WORDS))) {
    errors.push('stepContract.constraints must not contain publisher close / acceptance flow control.');
  }

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
      const stepContract = normalizeStepContract(params.stepContract) ?? buildDefaultStepContract(description);
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
