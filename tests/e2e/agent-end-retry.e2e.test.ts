import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end retry e2e', () => {
  test('retries once on transient timeout and succeeds on second attempt', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      let calls = 0;
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('LLM_DECISION_TIMEOUT');
        }
        return {
          decision: 'next',
          reason: '继续下一步',
          nextDescription: '继续补齐当前步骤缺失结果',
          nextTaskType: 'general',
          confidence: 'high',
        };
      };

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成任务',
        description: '先完成第一步',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：第一步完成。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
      expect(nextLog?.result?.llm?.attempts).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });
});

