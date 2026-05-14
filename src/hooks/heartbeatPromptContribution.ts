/**
 * M-Team hook: heartbeat_prompt_contribution
 *
 * - Executor heartbeat: claim-only guidance.
 * - Publisher heartbeat: timeout + acceptance guidance.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type {
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
} from '../types/openclaw-hooks.js';
import { getAgentActiveTask } from '../pool/index.js';
import { buildTaskTypeGuidanceBlock } from '../task-type.js';

interface RegisterOptions {
  executors: string[];
  publishers: string[];
}

const CLAIM_PROMPT = `## Heartbeat task: claim one task

You are in a heartbeat session. You can only claim tasks, not execute.

1) Call mteam_get_pending({ agentId }).
2) Read each task by taskType + description (current step only).
3) If suitable, call mteam_claim_task({ agentId, taskId }).
4) If nothing suitable, reply with reason.

Rules:
- description means current step only (not overall goal).
- goal is not for claim decision.
- do not execute work in heartbeat.
- do not call sessions_spawn / sessions_send.
- do not call mteam_relinquish_task in heartbeat claim flow.

Reply only: HEARTBEAT_OK`;

const PUBLISHER_ACCEPTANCE_PROMPT = `You are M-Team Publisher.

## Heartbeat duties
1) 超时检测 (timeout scan first):
- Call mteam_get_all_tasks({ status: 'running' }).
- Only inspect tasks where publisher is you.
- If updatedAt is older than 1 hour / 1 小时, call mteam_relinquish_task({ taskId, reason: '超时放回任务池' }).
- 最多处理 1 个超时任务 (process at most one stale task per heartbeat).

2) 无超时任务时, do acceptance second:
- Call mteam_get_all_tasks({ status: 'completed' }).
- Only inspect tasks where publisher is you.
- Pick the earliest completed task.
- Validate against goal + context trace + artifacts.
- This step targets COMPLETED tasks only.

Pass:
- Call mteam_close_task({ taskId, publisher: agentId }).

Reject:
- Call mteam_reject_task({ taskId, publisher: agentId, reason, description }) with a reason and next step description.
- Reason must include: (a) concrete issue, (b) explicit next step.

Process only one task and stop.
Reply only: HEARTBEAT_OK`;

function buildClaimPrompt(): string {
  const taskTypeGuidance = buildTaskTypeGuidanceBlock();
  return `${CLAIM_PROMPT}\n\n${taskTypeGuidance}\n\nDescription rule:\n- description is current baton only.\n- pick tasks whose description clearly matches your capability and current baton scope.`;
}

export function registerHeartbeatPromptContributionHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const executors = new Set(options.executors ?? ['maker', 'fixer', 'scholar', 'captain']);
  const publishers = new Set(options.publishers ?? []);

  api.on(
    'heartbeat_prompt_contribution',
    (
      event: PluginHeartbeatPromptContributionEvent,
      _ctx: unknown,
    ): PluginHeartbeatPromptContributionResult | undefined => {
      const { agentId } = event;
      if (!agentId) return undefined;

      if (publishers.has(agentId)) {
        api.logger?.info('[m-team] heartbeat inject publisher acceptance prompt');
        return { appendContext: PUBLISHER_ACCEPTANCE_PROMPT };
      }

      if (executors.has(agentId)) {
        const activeTask = getAgentActiveTask(agentId);
        if (activeTask) return undefined;

        api.logger?.info('[m-team] heartbeat inject claim prompt');
        return { appendContext: buildClaimPrompt() };
      }

      return undefined;
    },
  );
}
