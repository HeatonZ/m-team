import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publisher heartbeat acceptance e2e', () => {
  test('publisher heartbeat prefers timeout relinquish before acceptance', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const runningResult = await harness.exec('mteam_publish_task', {
        goal: '验证超时优先级',
        description: '先执行一个会超时的任务',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const runningTaskId = extractDetails(runningResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: runningTaskId, agentId: 'maker' }, { agentId: 'maker' });

      harness.mutateTask(runningTaskId, (task) => {
        task.updatedAt = Date.now() - 2 * 60 * 60 * 1000;
      });

      const completedResult = await harness.exec('mteam_publish_task', {
        goal: '验证 completed 不应抢跑',
        description: '先准备一个待验收任务',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const completedTaskId = extractDetails(completedResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: completedTaskId, agentId: 'fixer' }, { agentId: 'fixer' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终结果已形成',
        summary: '已输出待验收结果文件',
        confidence: 'high',
      });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/publisher-accept.md，验证 completed 不应抢跑，任务完成。' }],
        } as never,
        { agentId: 'fixer', sessionKey: `agent:fixer:m-team:${completedTaskId}` },
      );

      const publisherHeartbeat = harness.runHeartbeat('manager');
      expect(publisherHeartbeat?.appendContext).toContain('超时检测（每次心跳都要做）');
      expect(publisherHeartbeat?.appendContext).toContain('每次心跳最多处理 1 个超时任务');
      expect(publisherHeartbeat?.appendContext).toContain('无超时任务时才做');

      const relinquishResult = await harness.exec(
        'mteam_relinquish_task',
        { taskId: runningTaskId, reason: '超时放回任务池' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success?: boolean }>;
      expect(extractDetails(relinquishResult)?.success).toBe(true);

      const runningTask = harness.readTask(runningTaskId);
      expect(runningTask?.status).toBe('pending');

      const completedTask = harness.readTask(completedTaskId);
      expect(completedTask?.status).toBe('completed');
    } finally {
      await harness.cleanup();
    }
  });
});
