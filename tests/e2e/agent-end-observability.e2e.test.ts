import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end observability e2e', () => {
  test('llm next log should include structured llm data and normalized evidence', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '还需要下一步继续处理',
        nextDescription: '继续补齐剩余 3 个候选商品',
        nextTaskType: 'general',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '找到 5 个候选商品',
        description: '先整理首批候选商品',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已整理 2 个候选商品，记录在 /mnt/d/code/hermes/candidates.md。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
      expect(nextLog?.result?.llm?.source).toBe('llm');
      expect(nextLog?.result?.llm?.status).toBe('ok');
      expect(nextLog?.result?.llm?.parsed?.decision).toBe('next');
      expect(nextLog?.result?.llm?.attempts).toBe(1);
      expect(nextLog?.result?.reason).toBe('还需要下一步继续处理');
      expect(nextLog?.result?.evidence).toEqual({
        summary: '结果摘要：已整理 2 个候选商品，记录在 /mnt/d/code/hermes/candidates.md。',
        files: ['/mnt/d/code/hermes/candidates.md'],
        unresolvedIssues: [],
        error: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('llm fail-fast log should include llm error data and no fallback data', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成接口验证',
        description: '先调用接口并记录结果',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '阻塞：接口返回格式异常。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_fail_fast');
      expect(failLog?.result?.llm?.source).toBe('llm');
      expect(failLog?.result?.llm?.status).toBe('error');
      expect(failLog?.result?.llm?.attempts).toBe(1);
      expect(failLog?.result?.fallback).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
