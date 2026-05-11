/**
 * mteam_publish_task 工具定义
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

function inferPublisher(rawParams: PublishTaskParamsInterface, toolContext?: OpenClawPluginToolContext): string {
  const explicitPublisher = rawParams.publisher?.trim();
  if (explicitPublisher) return explicitPublisher;

  const contextAgentId = toolContext?.agentId?.trim();
  if (contextAgentId) return contextAgentId;

  throw new Error('mteam_publish_task 缺少 publisher：既未显式传 publisher，也未从 toolContext.agentId 推断到调用者');
}

type PublishToolParams = PublishTaskParamsInterface & {
  toolContext?: OpenClawPluginToolContext;
};

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_publish_task');
  api.registerTool({
    name: 'mteam_publish_task',
    label: '发布任务',
    description: '发布任务到 M-Team 任务池',
    parameters: PublishTaskParams,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = rawParams as PublishToolParams;
      const toolContext = params.toolContext;
      const publisher = inferPublisher(params, toolContext);
      api.logger?.info?.(`[m-team] publish execute sessionKey=${toolContext?.sessionKey ?? 'missing-session-key'} agentId=${toolContext?.agentId?.trim() ?? 'missing-agent-id'} rawPublisher=${params.publisher?.trim() ?? 'missing'} effectivePublisher=${publisher}`);
      const { description, goal, taskType, priority } = params;

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

      return textResult(`✅ 任务发布成功\n${task ? formatTaskAsText(task) : `ID: ${taskId}`}`, { taskId });
    },
  });
}
