import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('claim/active e2e', () => {
  test('claims a pending task and exposes active state only to the current agent', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成候选商品初筛',
        description: '先检查 5 个商品是否满足规格约束',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'maker',
      }) as ToolResult<{ task?: Record<string, unknown>; sessionKey?: string; runId?: string }>;
      const claimDetails = extractDetails(claimResult);
      expect(claimDetails?.task).not.toHaveProperty('goal');
      expect(claimDetails?.sessionKey).toBe(`agent:maker:m-team:${taskId}`);
      expect(claimDetails?.runId).toBe('test-run-id');

      const storedTask = harness.readTask(taskId);
      expect(storedTask?.status).toBe('running');
      expect(storedTask?.executor).toBe('maker');
      expect(storedTask?.lifecycle.phase).toBe('executing');

      const activeForMaker = await harness.exec('mteam_get_agent_active', { agentId: 'maker' }) as ToolResult<{ activeTask?: Record<string, unknown> | null }>;
      expect(extractDetails(activeForMaker)?.activeTask).toMatchObject({ taskId, executor: 'maker' });
      expect(extractDetails(activeForMaker)?.activeTask).not.toHaveProperty('goal');

      const activeForFixer = await harness.exec('mteam_get_agent_active', { agentId: 'fixer' }) as ToolResult<{ activeTask?: Record<string, unknown> | null }>;
      expect(extractDetails(activeForFixer)?.activeTask).toBeNull();

      const pendingForMaker = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<{ pending?: unknown[] }>;
      expect(extractDetails(pendingForMaker)?.pending).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });
});
