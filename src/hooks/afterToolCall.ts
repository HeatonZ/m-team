import { getTask } from '../pool/index.js';
import type {
  OpenClawPluginApi,
} from 'openclaw/plugin-sdk/core';
import type { PluginHookAfterToolCallEvent, OpenClawPluginToolContext } from '../types/openclaw-hooks.js';
import { writeTaskLog } from '../pool/db.js';

// toolName → action mapping
const TOOL_ACTION_MAP: Record<string, string> = {
  mteam_publish_task: 'publish',
  mteam_claim_task: 'claim',
  mteam_next_task: 'next',
  mteam_reject_task: 'reject',
  mteam_cancel_task: 'cancel',
  mteam_relinquish_task: 'relinquish',
  mteam_close_task: 'close',
};

export function registerAfterToolCallHook(api: OpenClawPluginApi): void {
  api.on(
    'after_tool_call',
    (
      event: PluginHookAfterToolCallEvent,
      ctx: OpenClawPluginToolContext,
    ): void => {
      const { toolName, params, result, error } = event;
      const { agentId, sessionKey } = ctx;

      // 只处理 mteam_* 工具
      const action = TOOL_ACTION_MAP[toolName];
      if (!action) return;

      // 从 params 提取 taskId（所有 mteam 工具都有 taskId，除了 publish）
      const taskId = params.taskId as string | undefined;

      if (toolName === 'mteam_publish_task') {
        // publish: 记录 publisher / description / goal（不含 input 防止泄露敏感数据）
        // result 是 AgentToolResult，taskId 在 result.details.taskId
        const resultObj = result as { details?: { taskId?: string } };
        const publishedTaskId = resultObj?.details?.taskId ?? 'unknown';
        const task = publishedTaskId !== 'unknown' ? getTask(publishedTaskId) : null;
        const taskPublisher = task?.publisher?.trim();
        const contextAgentId = agentId?.trim();
        if (taskPublisher && contextAgentId && taskPublisher !== contextAgentId) {
          api.logger?.error?.(`[m-team] publish ownership mismatch taskId=${publishedTaskId} taskPublisher=${taskPublisher} contextAgentId=${contextAgentId} sessionKey=${sessionKey ?? 'missing-session-key'}`);
        }
        writeTaskLog({
          taskId: publishedTaskId,
          action,
          sessionKey: sessionKey ?? undefined,
          agentId: agentId ?? undefined,
          params: {
            description: params.description as string | undefined,
            goal: params.goal as string | undefined,
            priority: params.priority as string | undefined,
            publisher: (params.publisher as string | undefined) ?? taskPublisher,
          },
          result: result as Record<string, unknown> | undefined,
        });
        return;
      }

      // claim / cancel / relinquish / close
      writeTaskLog({
        taskId: taskId ?? 'unknown',
        action,
        sessionKey: sessionKey ?? undefined,
        agentId: (params.agentId as string) ?? agentId ?? undefined,
        params: params as Record<string, unknown> | undefined,
        result: result as Record<string, unknown> | undefined,
        error: error ?? undefined,
      });
    },
  );
}
