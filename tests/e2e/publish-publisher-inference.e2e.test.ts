import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publish publisher inference', () => {
  test('falls back to toolContext agentId when raw publisher is omitted in direct-style session', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const result = await harness.exec('mteam_publish_task', {
        goal: 'verify direct session publisher inference',
        description: 'capture publisher value from direct session context',
        taskType: 'general',
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

  test('fails closed when publisher is omitted and toolContext agentId is missing', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      await expect(
        harness.getTool('mteam_publish_task').execute(
          'test-tool-call',
          {
            goal: 'verify publish is blocked without publisher identity',
            description: 'attempt publish without toolContext agentId',
            taskType: 'general',
            priority: 'high',
          },
          { sessionKey: 'agent:unknown:direct:ou_test_missing_agent' } as never,
        ),
      ).rejects.toThrow('mteam_publish_task missing publisher');
    } finally {
      await harness.cleanup();
    }
  });

  test('infers publisher from sessionKey when toolContext.agentId is missing', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const result = await harness.getTool('mteam_publish_task').execute(
        'test-tool-call',
        {
          goal: 'verify sessionKey publisher inference',
          description: 'capture publisher value from sessionKey fallback',
          taskType: 'general',
          priority: 'high',
          toolContext: { sessionKey: 'agent:manager:direct:ou_test_sessionkey_fallback' },
        } as never,
        undefined as never,
      ) as ToolResult<{ taskId: string }>;

      const taskId = extractDetails(result)!.taskId;
      const task = harness.readTask(taskId);
      expect(task?.publisher).toBe('manager');
    } finally {
      await harness.cleanup();
    }
  });
});

