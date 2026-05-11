import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';

const EXPECTED_TOOL_NAMES = [
  'mteam_publish_task',
  'mteam_claim_task',
  'mteam_next_task',
  'mteam_reject_task',
  'mteam_relinquish_task',
  'mteam_cancel_task',
  'mteam_close_task',
  'mteam_get_pending',
  'mteam_get_agent_active',
  'mteam_get_task',
  'mteam_get_all_tasks',
];

describe('m-team tool registration contract', () => {
  test('registers the expected tools with stable metadata', async () => {
    const harness = await createPluginHarness();
    try {
      const toolNames = harness.tools.map((tool) => tool.name);
      expect(toolNames).toEqual(EXPECTED_TOOL_NAMES);

      for (const tool of harness.tools) {
        expect(tool.label).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeTruthy();
        expect(typeof tool.execute).toBe('function');
      }
    } finally {
      await harness.cleanup();
    }
  });
});
