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
【任务信息】
- 任务ID: ${taskId}
- 任务类型: ${task?.taskType ?? 'general'}
- 任务目录: ${taskWorkdir}
- 执行者 agentId: ${agentId}

【工作区约束】
所有文件操作（读、写、终端命令）必须在任务目录内进行。

【角色边界】
- 你是 executor，只负责当前这一棒执行与汇报事实
- 你不负责宣布整条任务 complete / relay / retain / fail
- description 是当前一步；goal 是整任务终态标尺
- 本步完成 ≠ 整任务完成

【执行流程】
1. 先调用 mteam_get_task 查任务详情（含执行历史 + 当前 description）
2. 根据执行历史确认：前面已完成什么、当前这一棒要补什么、哪些问题正待处理
3. 只围绕当前 description 执行当前这一步，不要自行扩展为整条任务计划
4. 做完后最后一条消息必须结构化汇报 4 件事：
   - 结果摘要：当前步骤完成了什么
   - 产出文件 / 数据引用：留下了什么可验证产物
   - 未解决问题：当前还卡在哪、是否阻塞
   - 下一步：如果整任务未完成，明确写下一棒的单步动作；如果没有下一步，要说明为什么整个任务已满足 goal
5. 不要只写“任务完成”或“已完成”；必须同时写出产物、问题，以及“为什么整体已完成 / 为什么还没完成”
6. 做完后直接结束 session，m-team 会在 agent_end hook 收口并判断 complete / relay / fail / retain

【禁止事项】
- 禁止主动调用 mteam_relinquish_task / mteam_update_task / mteam_close_task
- 禁止替 agent_end 下裁决
- 禁止省略问题状态：即使本步有进展，也要说明是否仍存在影响整任务收口的缺口

`;

      const subagentRun = api.runtime?.subagent?.run({
        sessionKey,
        message: `[M-Team Task #${taskId}] \n\n${systemPrompt}`,
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
