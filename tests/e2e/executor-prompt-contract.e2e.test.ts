import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('executor prompt contract e2e', () => {
  test('claim-launched executor prompt should require structured step-level final report without exposing goal perspective', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'form final candidate conclusion',
        description: 'collect 3 candidate items',
        publisher: 'manager',
        stepContract: {
          expectedOutcome: 'produce a structured 3-item candidate result',
          doneWhen: ['candidates.md exists', 'contains at least 3 candidates'],
          constraints: ['only work on the current step'],
        },
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' }) as ToolResult<{ sessionKey: string }>;
      const claimText = extractText(claimResult);

      expect(claimText).toContain('Current step:');
      expect(claimText).not.toContain('Goal:');

      const runMessage = harness.readSubagentRuns().at(-1)?.message ?? '';
      expect(runMessage).toContain('Result summary');
      expect(runMessage).toContain('Output files / data references');
      expect(runMessage).toContain('Unresolved issues');
      expect(runMessage).toContain('Do not suggest the next step');
      expect(runMessage).toContain('You do not use the task goal as your execution target');
      expect(runMessage).not.toContain('Goal: form final candidate conclusion');
    } finally {
      await harness.cleanup();
    }
  });
});
