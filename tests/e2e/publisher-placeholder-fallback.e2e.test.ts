import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publisher placeholder fallback e2e', () => {
  test('session guard should replace publisher placeholder with caller identity', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'verify close fallback',
        description: 'create a completed task for close',
        taskType: 'general',
        publisher: 'manager',
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:main',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      harness.mutateTask(taskId, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.executor = null;
        task.acceptance = {
          taskDir: `/mnt/d/code/m-team/tasks/${taskId}`,
          summary: 'completed for close',
          files: [`/mnt/d/code/m-team/tasks/${taskId}/result.md`],
          updatedAt: Date.now(),
          source: 'agent_end',
        };
      });

      const preRead = await harness.exec('mteam_get_task_for_publisher', {
        taskId,
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:main:heartbeat',
      }) as ToolResult<{ blocked?: boolean }>;
      expect(extractDetails(preRead)?.blocked).not.toBe(true);

      for (const hook of harness.api.__hooks.before_tool_call) {
        hook({
          toolName: 'read',
          params: { path: `/mnt/d/code/m-team/tasks/${taskId}/result.md` },
        } as never, {
          agentId: 'manager',
          sessionKey: 'agent:manager:main:heartbeat',
        } as never);
      }

      const closeResult = await harness.exec('mteam_close_task', {
        taskId,
        publisher: 'publisher',
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:main:heartbeat',
      }) as ToolResult<{ success?: boolean; blocked?: boolean }>;

      const details = extractDetails(closeResult);
      if (details?.blocked) {
        throw new Error(`unexpected block: ${JSON.stringify(details)}`);
      }
      expect(details?.blocked).not.toBe(true);
      expect(details?.success).toBe(true);
      expect(harness.readTask(taskId)?.status).toBe('closed');
    } finally {
      await harness.cleanup();
    }
  });
});
