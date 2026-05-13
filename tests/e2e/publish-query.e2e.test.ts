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
  test('publishes a task and exposes only executor-safe query fields', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'finish one candidate collection task',
        description: 'collect 3 candidate items',
        taskType: 'research',
        priority: 'high',
      }, { agentId: 'manager' }) as ToolResult<PublishDetails>;

      const publishText = extractText(publishResult);
      const publishDetails = extractDetails(publishResult);
      expect(publishText.toLowerCase()).toContain('task');
      expect(publishDetails?.taskId).toMatch(/^task_/);

      const taskId = publishDetails!.taskId;
      const storedTask = harness.readTask(taskId);
      expect(storedTask?.goal).toBe('finish one candidate collection task');
      expect(storedTask?.description).toBe('collect 3 candidate items');
      expect(storedTask?.taskType).toBe('research');
      expect(storedTask?.publisher).toBe('manager');

      const getTaskResult = await harness.exec('mteam_get_task', { taskId }) as ToolResult<{ task: Record<string, unknown> }>;
      const getTaskText = extractText(getTaskResult);
      const getTaskDetails = extractDetails(getTaskResult);
      expect(getTaskText).toContain(taskId);
      expect(getTaskText).toContain('Current step: collect 3 candidate items');
      expect(getTaskText).not.toContain('finish one candidate collection task');
      expect(getTaskDetails?.task).not.toHaveProperty('goal');
      expect(getTaskDetails?.task).toHaveProperty('recentContext');

      const pendingResult = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<TaskListDetails>;
      const pendingText = extractText(pendingResult);
      const pendingDetails = extractDetails(pendingResult);
      expect(pendingText).toContain('Pending tasks: 1');
      expect(pendingText).toContain('Research');
      expect(pendingText).not.toContain('finish one candidate collection task');
      expect(pendingDetails?.pending?.[0]).not.toHaveProperty('goal');

      const allTasksResult = await harness.exec('mteam_get_all_tasks', {}) as ToolResult<TaskListDetails>;
      const allTasksText = extractText(allTasksResult);
      const allTasksDetails = extractDetails(allTasksResult);
      expect(allTasksText).toContain('All tasks');
      expect(allTasksText).not.toContain('finish one candidate collection task');
      expect(allTasksDetails?.tasks?.[0]).not.toHaveProperty('goal');
    } finally {
      await harness.cleanup();
    }
  });

  test('accepts minimal publish input', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'do the task',
        description: 'collect one data point',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      expect(extractDetails(publishResult)?.taskId).toMatch(/^task_/);
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects publish when description is multi-step', async () => {
    const harness = await createPluginHarness();
    try {
      await expect(
        harness.exec('mteam_publish_task', {
          goal: 'do the task',
          description: 'first collect data; then analyze',
          taskType: 'general',
          publisher: 'manager',
        }),
      ).rejects.toThrow('PUBLISH_DESCRIPTION_MULTI_STEP');
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects publish when goal is procedural multi-step text', async () => {
    const harness = await createPluginHarness();
    try {
      await expect(
        harness.exec('mteam_publish_task', {
          goal: 'first collect data then analyze and finally publish',
          description: 'collect one data point',
          taskType: 'general',
          publisher: 'manager',
        }),
      ).rejects.toThrow('PUBLISH_GOAL_SHOULD_BE_FINAL_STATE');
    } finally {
      await harness.cleanup();
    }
  });

  test('accepts ecommerce taskType', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'complete one cross-border listing task',
        description: 'prepare one product listing draft',
        taskType: 'ecommerce',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;

      const taskId = extractDetails(publishResult)!.taskId;
      const task = harness.readTask(taskId);
      expect(task?.taskType).toBe('ecommerce');
    } finally {
      await harness.cleanup();
    }
  });
});
