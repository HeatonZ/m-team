import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end conservative fallback e2e', () => {
  test('fails when messages are empty', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终结论',
        description: '先整理第 1 个候选商品',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('AGENT_END_MESSAGES_EMPTY');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails when executor session exits with error', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成接口验证',
        description: '先调用接口并记录结果',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: false,
          error: 'HTTP_500',
          messages: [{ role: 'assistant', content: '调用失败' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('HTTP_500');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails conservatively when llm parse fails and there is no recoverable progress', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成接口验证',
        description: '先调用接口并记录结果',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('conservative_fallback');
    } finally {
      await harness.cleanup();
    }
  });
});
