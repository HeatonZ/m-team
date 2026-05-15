import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('acceptance snapshot scope e2e', () => {
  test('completeTask acceptance files should keep only taskDir artifacts', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'finish final delivery',
        description: 'produce final artifacts',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      const inScope = 'result.md';
      const outOfScope = '/mnt/d/code/Star/packages/skills/captain/state/listed_offer_ids.txt';

      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: 'final output ready',
        summary: 'done',
        confidence: 'high',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            {
              role: 'assistant',
              content: `done\nfiles: ${inScope}, ${outOfScope}`,
            },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
      const files = task?.acceptance?.files ?? [];
      expect(files.some((file) => file.replace(/\\/g, '/').includes(`/tasks/${taskId}/result.md`))).toBe(true);
      expect(files.some((file) => file.includes('listed_offer_ids.txt'))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});
