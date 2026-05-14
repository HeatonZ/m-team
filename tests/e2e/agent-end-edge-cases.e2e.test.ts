import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end edge cases e2e', () => {
  test('fails task when executor session ends with success=false', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify runtime error handling for an executor step',
        description: 'Record a step that times out during execution',
        taskType: 'general',
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
      expect(harness.readLogs(taskId, 'fail')[0]?.error).toBe('TOOL_TIMEOUT');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails fast when assistant produces no usable progress and llm judge is unavailable', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify fail-fast behavior when no usable progress is reported',
        description: 'Record a step with no usable output',
        taskType: 'general',
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
      expect(failedTask?.context.at(-1)?.output?.error).toBe('RUNTIME_AGENT_END_JUDGE_EMPTY');
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps task pending across repeated next decisions when llm keeps returning the same actionable step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '继续补齐最终输出文件',
        nextDescription: '继续补齐最终输出文件',
        nextTaskType: 'general',
        summary: '已核对候选列表，待补最终输出文件。',
        confidence: 'medium',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify repeated next decisions do not fail immediately',
        description: 'Review the final output gap and record missing items',
        taskType: 'general',
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

      const firstNext = harness.readTask(taskId);
      expect(firstNext?.status).toBe('pending');
      expect(firstNext?.description).toBe('继续补齐最终输出文件');

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '最终整理：已核对候选列表，待补最终输出文件。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const secondNext = harness.readTask(taskId);
      expect(secondNext?.status).toBe('pending');
      expect(secondNext?.description).toBe('继续补齐最终输出文件');
      expect(secondNext?.context.at(-1)?.output?.summary).toContain('已核对候选列表');
      expect(harness.readLogs(taskId, 'fail')).toHaveLength(0);
      expect(harness.readLogs(taskId, 'next').length).toBeGreaterThanOrEqual(2);
    } finally {
      await harness.cleanup();
    }
  });
});
