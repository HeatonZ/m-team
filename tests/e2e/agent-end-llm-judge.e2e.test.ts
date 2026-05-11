import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end llm judge e2e', () => {
  test('uses llm decision complete when judge returns complete', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '整体 goal 已满足',
        summary: '已形成最终结果',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '整理最终结果并结束',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已整理完成。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
      const completeLog = harness.readLogs(taskId, 'complete').at(-1);
      expect(completeLog?.result?.via).toBe('llm');
    } finally {
      await harness.cleanup();
    }
  });

  test('uses llm decision relay with nextDescription', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'relay',
        reason: '还需下一棒继续',
        nextDescription: '继续补齐剩余 3 个候选商品',
        mode: 'handoff',
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
        messages: [{ role: 'assistant', content: '结果摘要：已保留 2 个候选。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toBe('继续补齐剩余 3 个候选商品');
      const relayLog = harness.readLogs(taskId, 'relay').at(-1);
      expect(relayLog?.result?.via).toBe('llm');
    } finally {
      await harness.cleanup();
    }
  });

  test('falls back to rule engine when llm judge parse fails', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '先整理 3 个候选商品信息',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [
          { role: 'assistant', content: '结果摘要：已完成首轮筛选，保留 2 个候选。下一步：继续搜索宠物玩具，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8，找够剩余 3 个' },
        ],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('继续搜索宠物玩具');
      const warns = harness.readRuntimeLogs().filter(log => log.level === 'warn').map(log => log.message).join('\n');
      expect(warns).toContain('agent_end llm judge fallback');
    } finally {
      await harness.cleanup();
    }
  });
});
