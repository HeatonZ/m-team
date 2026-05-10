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
  test('publishes a task and exposes visible query text without leaking goal', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '最终产出 1 份清晰的选品结论',
        description: '先整理 3 个候选商品的基础信息',
        taskType: 'research',
        publisher: 'manager',
        priority: 'high',
      }) as ToolResult<PublishDetails>;

      const publishText = extractText(publishResult);
      const publishDetails = extractDetails(publishResult);
      expect(publishText).toContain('任务发布成功');
      expect(publishDetails?.taskId).toMatch(/^task_/);

      const taskId = publishDetails!.taskId;
      const storedTask = harness.readTask(taskId);
      expect(storedTask?.goal).toBe('最终产出 1 份清晰的选品结论');
      expect(storedTask?.description).toBe('先整理 3 个候选商品的基础信息');
      expect(storedTask?.taskType).toBe('research');

      const getTaskResult = await harness.exec('mteam_get_task', { taskId }) as ToolResult<{ task: Record<string, unknown> }>;
      const getTaskText = extractText(getTaskResult);
      const getTaskDetails = extractDetails(getTaskResult);
      expect(getTaskText).toContain(taskId);
      expect(getTaskText).toContain('当前步骤: 先整理 3 个候选商品的基础信息');
      expect(getTaskText).toContain('目标: 最终产出 1 份清晰的选品结论');
      expect(getTaskDetails?.task).not.toHaveProperty('goal');

      const pendingResult = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<TaskListDetails>;
      const pendingText = extractText(pendingResult);
      const pendingDetails = extractDetails(pendingResult);
      expect(pendingText).toContain('待认领任务 1 个');
      expect(pendingText).toContain('调研');
      expect(pendingText).not.toContain('最终产出 1 份清晰的选品结论');
      expect(pendingDetails?.pending?.[0]).not.toHaveProperty('goal');

      const allTasksResult = await harness.exec('mteam_get_all_tasks', {}) as ToolResult<TaskListDetails>;
      const allTasksText = extractText(allTasksResult);
      const allTasksDetails = extractDetails(allTasksResult);
      expect(allTasksText).toContain('全部任务');
      expect(allTasksText).not.toContain('最终产出 1 份清晰的选品结论');
      expect(allTasksDetails?.tasks?.[0]).not.toHaveProperty('goal');
    } finally {
      await harness.cleanup();
    }
  });
});
