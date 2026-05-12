import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publisher heartbeat acceptance e2e', () => {
  test('publisher heartbeat prefers timeout relinquish before acceptance', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const runningResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify timeout handling is prioritized',
        description: 'Record a step that becomes stale after claim',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const runningTaskId = extractDetails(runningResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: runningTaskId, agentId: 'maker' }, { agentId: 'maker' });

      harness.mutateTask(runningTaskId, (task) => {
        task.updatedAt = Date.now() - 2 * 60 * 60 * 1000;
      });

      const completedResult = await harness.exec('mteam_publish_task', {
        goal: 'Produce a finished result that remains completed',
        description: 'Generate a result file for later acceptance',
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
          messages: [{ role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/publisher-accept.md，任务完成。' }],
        } as never,
        { agentId: 'fixer', sessionKey: `agent:fixer:m-team:${completedTaskId}:test-session` },
      );

      const publisherHeartbeat = harness.runHeartbeat('manager');
      expect(publisherHeartbeat?.appendContext).toContain('超时检测');
      expect(publisherHeartbeat?.appendContext).toContain('最多处理 1 个超时任务');
      expect(publisherHeartbeat?.appendContext).toContain('无超时任务时');

      const relinquishResult = await harness.exec(
        'mteam_relinquish_task',
        { taskId: runningTaskId, executorId: 'maker', reason: '超时放回任务池' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success?: boolean }>;
      expect(extractDetails(relinquishResult)?.success).toBe(true);

      expect(harness.readTask(runningTaskId)?.status).toBe('pending');
      expect(harness.readTask(completedTaskId)?.status).toBe('completed');
    } finally {
      await harness.cleanup();
    }
  });

  test('publisher heartbeat cannot relinquish a running task before it is actually stale', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify publisher heartbeat does not reclaim fresh running work',
        description: 'Create a fresh running task that is not stale yet',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      const relinquishResult = await harness.exec(
        'mteam_relinquish_task',
        { taskId, executorId: 'maker', reason: '超时放回任务池' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success?: boolean; reason?: string }>;

      expect(extractDetails(relinquishResult)?.success).toBe(false);
      expect(extractText(relinquishResult)).toContain('TASK_NOT_STALE_ENOUGH_FOR_RELINQUISH');
      expect(harness.readTask(taskId)?.status).toBe('running');
      expect(harness.readTask(taskId)?.executor).toBe('maker');
    } finally {
      await harness.cleanup();
    }
  });
});
