import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end fallback lookup', () => {
  test('uses DB fallback when runtime.storage is unavailable', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证 agent_end 兼容真实 runtime',
        description: '先产出最终结果并结束',
        publisher: 'manager',
      }, { agentId: 'manager' }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      // 模拟真实运行态没有 runtime.storage
      (harness.api as unknown as { runtime?: { storage?: unknown } }).runtime = {
        ...(harness.api as unknown as { runtime?: Record<string, unknown> }).runtime,
        storage: undefined,
      };

      await harness.runAgentEnd({
        success: true,
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: '最终结果：已输出 /mnt/d/code/hermes/result.md，验证 agent_end 兼容真实 runtime，任务完成。' }] },
        ],
      } as never, {
        agentId: 'maker',
        sessionKey: `agent:maker:m-team:${taskId}:test-session`,
      });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');

      const completeLog = harness.readLogs(taskId).find((entry) => entry.action === 'complete');
      expect(completeLog).toBeTruthy();
    } finally {
      await harness.cleanup();
    }
  });
});
