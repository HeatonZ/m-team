import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end edge cases e2e', () => {
  test('fails task when executor session ends with success=false', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证异常失败链路',
        description: '先执行异常任务',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: false,
          error: 'TOOL_TIMEOUT',
          messages: [{ role: 'assistant', content: '执行中断' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const failedTask = harness.readTask(taskId);
      expect(failedTask?.status).toBe('failed');
      expect(failedTask?.context.at(-1)?.output?.error).toBe('TOOL_TIMEOUT');

      const failLogs = harness.readLogs(taskId, 'fail');
      expect(failLogs[0]?.error).toBe('TOOL_TIMEOUT');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails task when assistant produces no recoverable progress', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证无进展失败链路',
        description: '先做无进展任务',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: 'NO_REPLY' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const failedTask = harness.readTask(taskId);
      expect(failedTask?.status).toBe('failed');
      expect(failedTask?.context.at(-1)?.output?.error).toBe('NO_RECOVERABLE_PROGRESS');
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps task running on repeated retains without progress when llm does not fail it', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '继续补齐最终输出文件',
        nextDescription: '继续补齐最终输出文件',
        summary: '已核对候选列表，待补最终输出文件。',
        confidence: 'medium',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证循环熔断',
        description: '先整理最终结果并核对缺口',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终整理：已核对候选列表，待补最终输出文件。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const finalizingTask = harness.readTask(taskId);
      expect(finalizingTask?.status).toBe('pending');
      expect(finalizingTask?.description).toBe('继续补齐最终输出文件');

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终整理：已核对候选列表，待补最终输出文件。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const failedTask = harness.readTask(taskId);
      expect(failedTask?.status).toBe('pending');
      expect(failedTask?.description).toBe('继续补齐最终输出文件');
      expect(failedTask?.context.at(-1)?.output?.summary).toContain('最终整理');

      const failLogs = harness.readLogs(taskId, 'fail');
      expect(failLogs).toHaveLength(0);
      const nextLogs = harness.readLogs(taskId, 'next');
      expect(nextLogs.length).toBeGreaterThanOrEqual(2);
    } finally {
      await harness.cleanup();
    }
  });
});
