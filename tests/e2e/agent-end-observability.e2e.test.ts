import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end observability e2e', () => {
  test('llm next log should include raw decision and normalized evidence', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '还需要下一棒补齐剩余候选',
        nextDescription: '继续补齐剩余 3 个候选商品',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '找够 5 个候选商品',
        description: '先整理首批候选',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已整理 2 个候选，记录在 /mnt/d/code/hermes/candidates.md。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
      expect(nextLog?.result?.llm_raw).toContain('next');
      expect(nextLog?.result?.reason).toBe('还需要下一棒补齐剩余候选');
      expect(nextLog?.result?.evidence).toEqual({
        summary: '结果摘要：已整理 2 个候选，记录在 /mnt/d/code/hermes/candidates.md。',
        files: ['/mnt/d/code/hermes/candidates.md'],
        unresolvedIssues: [],
        error: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('fallback should fail on blocker-only transcript without positive progress', async () => {
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

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '阻塞：接口报错，无法继续。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('conservative_fallback');
      expect(failLog?.result?.reason).toBe('LLM_UNAVAILABLE_AND_BLOCKED');
    } finally {
      await harness.cleanup();
    }
  });

  test('fallback should return next when transcript is short but contains file evidence', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成结果归档',
        description: '先输出归档文件',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '/mnt/d/code/hermes/archive.md' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('conservative_fallback');
      expect(nextLog?.result?.evidence).toEqual({
        summary: '/mnt/d/code/hermes/archive.md',
        files: ['/mnt/d/code/hermes/archive.md'],
        unresolvedIssues: [],
        error: null,
      });
    } finally {
      await harness.cleanup();
    }
  });
});
