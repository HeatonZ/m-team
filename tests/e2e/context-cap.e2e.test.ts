import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('context cap e2e', () => {
  test('keeps only the latest context steps', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'verify context cap',
        description: 'run one step',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      for (let i = 0; i < 45; i++) {
        await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
        await harness.exec('mteam_next_task', {
          taskId,
          agentId: 'maker',
          contextStep: `step-${i}`,
          contextOutput: { summary: `summary-${i}` },
          description: 'run one step',
        }, { agentId: 'maker', sessionKey: 'agent:maker:manual' });
      }

      const task = harness.readTask(taskId);
      expect(task?.context.length).toBe(40);
      expect(task?.context[0]?.type).toBe('step');
      expect((task?.context[0] as { step?: string })?.step).toBe('step-5');
      expect((task?.context.at(-1) as { step?: string })?.step).toBe('step-44');
    } finally {
      await harness.cleanup();
    }
  });
});
