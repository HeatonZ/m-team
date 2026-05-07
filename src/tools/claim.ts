/**
 * mteam_claim_task 工具定义
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { claimTask, getTask, relinquishTask } from '../pool/index.js';
import { sanitizeTask, formatTaskAsText } from './helpers.js';
import { formatClaimNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import type { ClaimTaskParamsInterface } from '../types/tools.js';
import { ClaimTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_claim_task');
  api.registerTool({
    name: 'mteam_claim_task',
    label: '认领任务',
    description: '认领一个待处理任务（Plugin内部直接创建executor session）',
    parameters: ClaimTaskParams,
    async execute(_toolCallId: string, rawParams: ClaimTaskParamsInterface) {
      const { taskId, agentId } = rawParams;
      readTaskId(rawParams, 'taskId', { required: true }); // 格式校验

      const result = claimTask(taskId, agentId);
      if (!result.success) return failedTextResult(result.reason || '操作失败', { success: result.success, reason: result.reason });

      const task = getTask(taskId) ?? result.task;
      const sanitized = task ? sanitizeTask(task) : undefined;

      if (task && config.notifications?.length) {
        try {
          const notifications = formatClaimNotifications(task, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch (e) {
          api.logger?.warn('[m-team] 通知发送失败');
        }
      }

      const sessionKey = `agent:${agentId}:m-team:${taskId}`;
      const taskWorkdir = `${config.workspaceRoot ?? '/mnt/d/code/m-team'}/tasks/${taskId}`;

      const systemPrompt = `
|【任务信息】
- 任务ID: ${taskId}
- 任务描述（当前这一步做什么）: ${task?.description ?? ''}
- 执行者 agentId: ${agentId}
- 任务目录: ${taskWorkdir}
- 工作区约束：所有文件操作（读、写、终端命令）必须在任务目录内进行

|【任务认领状态】
任务已被心跳 session（${agentId}）认领，处于 RUNNING 状态。
禁止调用 mteam_claim_task——任务不在 PENDING 状态，会失败。

|【执行约束 — 必须遵守】
- 你是 executor，不是 publisher。禁止调用 mteam_publish_task 创建新任务。
- description 写什么就做什么，不拆分、不裂变、不创建子任务。
- 做完后直接结束 session，agent_end hook 会自动判断 complete 还是 relay。
`;

      const subagentRun = api.runtime?.subagent?.run({
        sessionKey,
        message: `[M-Team Task #${taskId}] ${task?.description ?? ''}\n\n${systemPrompt}`,
      }).catch((_runErr: unknown) => {
        api.logger?.error('[m-team] subagent.run 异步启动失败，回滚任务状态');
        relinquishTask(taskId, agentId);
        return { runId: null };
      });

      const subagentResult = await subagentRun;

      return textResult(`✅ 任务认领成功\n${formatTaskAsText(task!)}`, {
        success: result.success,
        taskId: result.taskId,
        task: sanitized,
        runId: subagentResult?.runId,
        sessionKey,
      });
    },
  });
}
