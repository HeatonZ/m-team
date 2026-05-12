import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('executor goal isolation and completion discipline', () => {
  test('claim prompt and get_task text should not expose goal to executor', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，输出三个结果',
        description: '计算 1+1',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      const claimText = extractText(claimResult);
      expect(claimText).not.toContain('目标:');
      expect(claimText).not.toContain('完成 1+1、1×1、2+3 三个计算');

      const getTaskResult = await harness.exec('mteam_get_task', { taskId }, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });
      const taskText = extractText(getTaskResult);
      expect(taskText).not.toContain('目标:');
      expect(taskText).not.toContain('完成 1+1、1×1、2+3 三个计算');
    } finally {
      await harness.cleanup();
    }
  });

  test('agent_end should not complete when llm asks for a next step after only restating current step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '继续补齐当前步骤的结构化结果',
        nextDescription: '继续补齐当前步骤的结构化结果',
        summary: '仅完成当前一步，不足以证明整体 goal',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，输出三个结果',
        description: '计算 1+1',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '结果摘要：已完成计算 1+1，结果为 2。任务完成。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('继续补齐当前步骤');
      expect(task?.context.at(-1)?.output?.summary).toContain('仅完成当前一步');
    } finally {
      await harness.cleanup();
    }
  });
});
