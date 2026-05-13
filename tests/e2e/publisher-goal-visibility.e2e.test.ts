import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('publisher goal visibility boundary', () => {
  test('publisher-facing close and reject responses should include goal for acceptance context', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 3 个算式并汇总到最终结果',
        description: '计算第一个算式 1+1',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      harness.mutateTask(taskId, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.executor = null;
        task.lastExecutor = 'maker';
      });

      const closeResult = await harness.exec('mteam_close_task', { taskId, publisher: 'manager' }, { agentId: 'manager' });
      const closeText = extractText(closeResult);
      expect(closeText).toContain('Goal: 完成 3 个算式并汇总到最终结果');
      expect(closeText).toContain('Current step: 计算第一个算式 1+1');

      const publishAgain = await harness.exec('mteam_publish_task', {
        goal: '完成 5 个候选商品复核并给出结论',
        description: '复核第 1 个候选商品',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId2 = extractDetails(publishAgain)!.taskId;

      harness.mutateTask(taskId2, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.executor = null;
        task.lastExecutor = 'maker';
      });

      const rejectResult = await harness.exec(
        'mteam_reject_task',
        {
          taskId: taskId2,
          reason: '验收驳回：证据不足',
          description: '补齐价格对比和销量截图',
        },
        { agentId: 'manager' },
      );
      const rejectText = extractText(rejectResult);
      expect(rejectText).toContain('Goal: 完成 5 个候选商品复核并给出结论');
      expect(rejectText).toContain('Current step: 补齐价格对比和销量截图');
    } finally {
      await harness.cleanup();
    }
  });
});
