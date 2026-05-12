/**
 * mteam_claim_task tool definition.
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { claimTask, getTask, relinquishTask } from '../pool/index.js';
import { sanitizeTask, formatTaskAsText } from './helpers.js';
import { formatClaimNotifications, sendNotifications } from '../notifications.js';
import type { ClaimTaskParamsInterface } from '../types/tools.js';
import { ClaimTaskParams } from '../types/tools.js';

export function register(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  api.logger?.info('[m-team] registering mteam_claim_task');
  api.registerTool({
    name: 'mteam_claim_task',
    label: 'Claim task',
    description: 'Claim a pending task and start an executor session inside the plugin',
    parameters: ClaimTaskParams,
    async execute(_toolCallId: string, rawParams: ClaimTaskParamsInterface) {
      const { taskId, agentId } = rawParams;
      readTaskId(rawParams, 'taskId', { required: true });

      const result = claimTask(taskId, agentId);
      if (!result.success) {
        return failedTextResult(result.reason || 'Operation failed', {
          success: result.success,
          reason: result.reason,
        });
      }

      const task = getTask(taskId) ?? result.task;
      const sanitized = task ? sanitizeTask(task) : undefined;

      if (task && config.notifications?.length) {
        try {
          const notifications = formatClaimNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] claim notifications failed');
        }
      }

      const sessionKey = `agent:${agentId}:m-team:${taskId}`;
      const taskWorkdir = `${config.workspaceRoot ?? '/mnt/d/code/m-team'}/tasks/${taskId}`;

      const systemPrompt = `
[Task info]
- Task ID: ${taskId}
- Task type: ${task?.taskType ?? 'general'}
- Task workdir: ${taskWorkdir}
- Executor agentId: ${agentId}

[Workspace rule]
All file operations and terminal commands must stay inside the task workdir.

[Role boundary]
- You are the executor for the current step only.
- You do not decide complete / next / fail.
- You do not use the task goal as your execution target.
- The description is the current step, not the whole-task plan.

[Execution flow]
1. Call mteam_get_task first.
2. Read the recent history and the current step contract.
3. Execute only the current step.
4. If you hit a problem, you may do minimal checking or one retry, but do not expand into a long recovery chain.
5. Report facts clearly: what was completed, what files were produced, and what unresolved issues remain.
6. The final message must include:
   - Result summary
   - Output files / data references
   - Unresolved issues (or explicitly say no unresolved issues)
7. Report only step-level facts. Do not write whole-task judgments such as goal reached, task complete, wait for publisher, or close task.
8. Do not suggest the next step. agent_end decides that.
9. End the session after the step report.

[Language rule]
- All natural-language reporting must be in Chinese.
- Write the result summary, issue report, and step explanation in Chinese.
- If you create markdown or text artifacts, prefer Chinese unless the current step explicitly requires another language.
- Do not translate code, JSON keys, API fields, or file paths unless explicitly required.

[Forbidden]
- Do not call mteam_relinquish_task / mteam_update_task / mteam_close_task proactively.
- Do not replace agent_end.
- Do not turn the current step into a whole-task plan.
`;

      const subagentRun = api.runtime?.subagent?.run({
        sessionKey,
        message: `[M-Team Task #${taskId}]\n\n${systemPrompt}`,
      }).catch((_runErr: unknown) => {
        api.logger?.error('[m-team] subagent.run failed, rolling back task state');
        relinquishTask(taskId, agentId);
        return { runId: null };
      });

      const subagentResult = await subagentRun;

      return textResult(`OK claimed task\n${formatTaskAsText(task!)}`, {
        success: result.success,
        taskId: result.taskId,
        task: sanitized,
        runId: subagentResult?.runId,
        sessionKey,
      });
    },
  });
}
