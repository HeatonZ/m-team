import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end ecommerce taskType guard e2e', () => {
  test('keeps nextTaskType as ecommerce when listing baton is misclassified as content', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: 'listing copy generated, proceed to next listing operation',
        nextDescription: '为5个SKU生成英文listing并写入 english_listings.json',
        nextTaskType: 'content',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成5个SKU跨境电商上架闭环',
        description: '准备SKU上架资料并执行ERP采集箱流程',
        taskType: 'ecommerce',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'captain' }, { agentId: 'captain' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '已完成SKU文案草拟，下一步继续上架采集箱。' }],
        } as never,
        { agentId: 'captain', sessionKey: `agent:captain:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.taskType).toBe('ecommerce');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.requestedNextTaskType).toBe('content');
      expect(nextLog?.result?.nextTaskType).toBe('ecommerce');
      expect(nextLog?.result?.taskTypeNormalizedBy).toBe('ecommerce_guard');
    } finally {
      await harness.cleanup();
    }
  });
});

