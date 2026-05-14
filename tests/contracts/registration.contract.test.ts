import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { TASK_TYPE_INLINE_HINT, DESCRIPTION_INLINE_HINT } from '../../src/task-type.js';
import { GOAL_INLINE_HINT, CONTEXT_OUTPUT_INLINE_HINT } from '../../src/task-contract.js';

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
  'mteam_get_task_for_publisher',
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

  test('publish and next parameter descriptions expose taskType and description semantics', async () => {
    const harness = await createPluginHarness();
    try {
      const publishTool = harness.getTool('mteam_publish_task');
      const publishParams = publishTool.parameters as {
        properties?: {
          taskType?: { description?: string };
          description?: { description?: string };
          goal?: { description?: string };
        };
      };

      expect(publishParams.properties?.taskType?.description).toContain(TASK_TYPE_INLINE_HINT);
      expect(publishParams.properties?.description?.description).toContain(DESCRIPTION_INLINE_HINT);
      expect(publishParams.properties?.goal?.description).toContain(GOAL_INLINE_HINT);

      const nextTool = harness.getTool('mteam_next_task');
      const nextParams = nextTool.parameters as {
        properties?: {
          nextTaskType?: { description?: string };
          description?: { description?: string };
          contextOutput?: { description?: string };
        };
      };

      expect(nextParams.properties?.nextTaskType?.description).toContain(TASK_TYPE_INLINE_HINT);
      expect(nextParams.properties?.description?.description).toContain(DESCRIPTION_INLINE_HINT);
      expect(nextParams.properties?.contextOutput?.description).toContain(CONTEXT_OUTPUT_INLINE_HINT);
    } finally {
      await harness.cleanup();
    }
  });
});
