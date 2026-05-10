import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publish publisher inference', () => {
  test('falls back to toolContext agentId when raw publisher is omitted in direct-style session', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const result = await harness.exec('mteam_publish_task', {
        goal: '验证 direct session 的 publisher 推断',
        description: '只发布，不显式传 publisher',
        priority: 'high',
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:direct:ou_test_direct_session',
      }) as ToolResult<{ taskId: string }>;

      const taskId = extractDetails(result)!.taskId;
      const task = harness.readTask(taskId);
      expect(task?.publisher).toBe('manager');

      const logs = harness.readRuntimeLogs();
      expect(logs.some((entry) => entry.message.includes('publish execute sessionKey=agent:manager:direct:ou_test_direct_session'))).toBe(true);
      expect(logs.some((entry) => entry.message.includes('effectivePublisher=manager'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
