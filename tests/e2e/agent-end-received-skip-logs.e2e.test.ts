import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end received and skip observability e2e', () => {
  test('logs received and skip reason when session is not executor task session', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'verify agent_end skip logs',
        description: 'run one tiny step',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: 'done' }],
      } as never, {
        agentId: 'maker',
        sessionKey: 'agent:maker:manual',
      });

      const logs = harness.readRuntimeLogs();
      expect(logs.some((entry) => entry.message.includes('agent_end received'))).toBe(true);
      expect(logs.some((entry) => entry.message.includes('agent_end skip reason=SESSION_TASK_ID_MISS'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  test('logs skip reason when task status is not running', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'verify status-based skip logs',
        description: 'run one tiny step',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      harness.mutateTask(taskId, (task) => {
        task.status = 'pending';
        task.executor = null;
        task.updatedAt = Date.now();
      });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: 'done' }],
      } as never, {
        agentId: 'maker',
        sessionKey: `agent:maker:m-team:${taskId}:test-session`,
      });

      const logs = harness.readRuntimeLogs();
      expect(logs.some((entry) => entry.message.includes('agent_end received'))).toBe(true);
      expect(logs.some((entry) => entry.message.includes('agent_end skip reason=TASK_NOT_RUNNING'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
