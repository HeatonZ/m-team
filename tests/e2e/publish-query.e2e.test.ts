import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

interface TaskListDetails {
  pending?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
}

describe('publish/query e2e', () => {
  test('publishes a task with stepContract and exposes only executor-safe query fields', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '???? 1 ????????',
        description: '??? 3 ??????????',
        taskType: 'research',
        priority: 'high',
        stepContract: {
          expectedOutputs: [{ kind: 'report', path: 'candidate_report.md', formatHint: 'markdown' }],
          doneWhen: ['candidate_report.md ???', '????? 3 ??????????'],
          constraints: ['????? 3 ???????????'],
        },
      }, { agentId: 'manager' }) as ToolResult<PublishDetails>;

      const publishText = extractText(publishResult);
      const publishDetails = extractDetails(publishResult);
      expect(publishText).toContain('??????');
      expect(publishDetails?.taskId).toMatch(/^task_/);

      const taskId = publishDetails!.taskId;
      const storedTask = harness.readTask(taskId);
      expect(storedTask?.goal).toBe('???? 1 ????????');
      expect(storedTask?.description).toBe('??? 3 ??????????');
      expect(storedTask?.taskType).toBe('research');
      expect(storedTask?.publisher).toBe('manager');
      expect(storedTask?.stepContract?.expectedOutputs?.[0]?.path).toBe('candidate_report.md');
      expect(storedTask?.stepContract?.doneWhen?.[0]).toContain('candidate_report.md');

      const getTaskResult = await harness.exec('mteam_get_task', { taskId }) as ToolResult<{ task: Record<string, unknown> }>;
      const getTaskText = extractText(getTaskResult);
      const getTaskDetails = extractDetails(getTaskResult);
      expect(getTaskText).toContain(taskId);
      expect(getTaskText).toContain('Current step: ??? 3 ??????????');
      expect(getTaskText).toContain('[Expected outputs]');
      expect(getTaskText).toContain('candidate_report.md');
      expect(getTaskText).not.toContain('???? 1 ????????');
      expect(getTaskDetails?.task).not.toHaveProperty('goal');
      expect(getTaskDetails?.task).toHaveProperty('stepContract');
      expect(getTaskDetails?.task).toHaveProperty('recentContext');

      const pendingResult = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<TaskListDetails>;
      const pendingText = extractText(pendingResult);
      const pendingDetails = extractDetails(pendingResult);
      expect(pendingText).toContain('????? 1 ?');
      expect(pendingText).toContain('Research');
      expect(pendingText).not.toContain('???? 1 ????????');
      expect(pendingDetails?.pending?.[0]).not.toHaveProperty('goal');
      expect(pendingDetails?.pending?.[0]).toHaveProperty('stepContract');

      const allTasksResult = await harness.exec('mteam_get_all_tasks', {}) as ToolResult<TaskListDetails>;
      const allTasksText = extractText(allTasksResult);
      const allTasksDetails = extractDetails(allTasksResult);
      expect(allTasksText).toContain('All tasks');
      expect(allTasksText).not.toContain('???? 1 ????????');
      expect(allTasksDetails?.tasks?.[0]).not.toHaveProperty('goal');
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects low-quality publish input without stepContract', async () => {
    const harness = await createPluginHarness();
    try {
      await expect(harness.exec('mteam_publish_task', {
        goal: '?????',
        description: '?????????????',
        publisher: 'manager',
      })).rejects.toThrow(/stepContract|??|????/);
    } finally {
      await harness.cleanup();
    }
  });
});
