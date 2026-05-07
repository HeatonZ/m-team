/**
 * mteam_claim_task 工具定义
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { readStringParam } from 'openclaw/plugin-sdk/core';
import { textResult, failedTextResult, readTaskId } from './shared.js';
import { claimTask, getTask, relinquishTask } from '../pool/index.js';
import { sanitizeTask } from './helpers.js';
import { formatClaimNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { ClaimTaskParams } from '../types/tools.js';
import type { MTeamPluginConfig } from '../config.js';

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
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const agentId = readStringParam(rawParams, 'agentId', { required: true })!;

      const result = claimTask(taskId, agentId);
      if (!result.success) return failedTextResult(result.error ?? '操作失败', { success: result.success, reason: result.reason });

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

|【必读】执行规范
加载 m-team-executor skill（/skill m-team-executor），严格按照其中的决策框架和检查清单执行。

|【任务认领状态】
任务已被心跳 session（${agentId}）认领，处于 RUNNING 状态。
禁止调用 mteam_claim_task——任务不在 PENDING 状态，会失败。

|【禁止】
- 在未调用任何工具的情况下自行结束会话（任务将永久卡在 running 状态）
- 在 tool call 的 agentId 参数中传入 subagent 自己的 session agentId，必须传入 ${agentId}
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

      return textResult('任务认领成功', {
        success: result.success,
        taskId: result.taskId,
        task: sanitized,
        runId: subagentResult?.runId,
        sessionKey,
      });
    },
  });
}
