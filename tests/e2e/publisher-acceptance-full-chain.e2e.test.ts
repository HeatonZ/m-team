import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publisher acceptance full chain e2e', () => {
  test('publisher can close a completed task after agent_end marks it completed', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '先整理最终结果文件',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '整体 goal 已满足',
        summary: '最终结果文件已形成',
        confidence: 'high',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/final-result.md。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      expect(harness.readTask(taskId)?.status).toBe('completed');
      const publisherHeartbeat = harness.runHeartbeat('manager');
      expect(publisherHeartbeat?.appendContext).toContain('验收 COMPLETED 任务');

      const closeResult = await harness.exec(
        'mteam_close_task',
        { taskId, publisher: 'manager' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success: boolean }>;

      expect(extractDetails(closeResult)?.success).toBe(true);
      const closedTask = harness.readTask(taskId);
      expect(closedTask?.status).toBe('closed');
    } finally {
      await harness.cleanup();
    }
  });

  test('publisher can reject a completed task and send it back to pending with next step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '整理可验收的候选报告',
        description: '先输出候选报告',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: 'executor 认为已完成',
        summary: '已提交候选报告',
        confidence: 'medium',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/candidate-report.md。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      expect(harness.readTask(taskId)?.status).toBe('completed');

      const rejectResult = await harness.exec(
        'mteam_reject_task',
        { taskId, reason: '验收驳回：缺少价格对比证据。下一步：补齐价格对比截图并重新提交候选报告' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ task?: Record<string, unknown> }>;

      expect(extractDetails(rejectResult)?.task).toBeTruthy();
      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toBe('补齐价格对比截图并重新提交候选报告');
      expect(task?.context.at(-1)?.step).toContain('验收驳回');
    } finally {
      await harness.cleanup();
    }
  });

  test('publisher heartbeat timeout path can relinquish stale running task before acceptance', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证超时回收优先',
        description: '先执行一个会超时的任务',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      harness.mutateTask(taskId, task => {
        task.updatedAt = Date.now() - 2 * 60 * 60 * 1000;
      });

      const publisherHeartbeat = harness.runHeartbeat('manager');
      expect(publisherHeartbeat?.appendContext).toContain('updatedAt 距今超过 1 小时');

      const relinquishResult = await harness.exec(
        'mteam_relinquish_task',
        { taskId, reason: '超时放回任务池' },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success: boolean }>;

      expect(extractDetails(relinquishResult)?.success).toBe(true);
      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.executor).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
