import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end fallback lookup', () => {
  test('uses DB fallback when runtime.storage is unavailable', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终结果文件已生成',
        summary: '已输出 result.md，任务完成。',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证 agent_end 兼容真实 runtime',
        description: '生成最终结果并结束',
        taskType: 'general',
        publisher: 'manager',
      }, { agentId: 'manager' }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      (harness.api as unknown as { runtime?: { storage?: unknown } }).runtime = {
        ...(harness.api as unknown as { runtime?: Record<string, unknown> }).runtime,
        storage: undefined,
      };

      await harness.runAgentEnd({
        success: true,
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: '最终结果：已输出 /mnt/d/code/hermes/result.md，任务完成。' }] },
        ],
      } as never, {
        agentId: 'maker',
        sessionKey: `agent:maker:m-team:${taskId}:test-session`,
      });

      expect(harness.readTask(taskId)?.status).toBe('completed');
      expect(harness.readLogs(taskId).find((entry) => entry.action === 'complete')).toBeTruthy();
    } finally {
      await harness.cleanup();
    }
  });
});
