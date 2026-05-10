import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('publisher terminal actions e2e', () => {
  test('supports cancel, close, and reject flows for publisher-facing tools', async () => {
    const harness = await createPluginHarness();
    try {
      const cancelPublish = await harness.exec('mteam_publish_task', {
        goal: '准备取消测试任务',
        description: '生成一个可取消任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const cancelTaskId = extractDetails(cancelPublish)!.taskId;

      const cancelResult = await harness.exec('mteam_cancel_task', {
        taskId: cancelTaskId,
        publisher: 'manager',
        reason: '需求取消',
      }) as ToolResult<{ success: boolean; task?: Record<string, unknown> }>;
      expect(extractDetails(cancelResult)?.success).toBe(true);
      expect(harness.readTask(cancelTaskId)?.status).toBe('cancelled');

      const closePublish = await harness.exec('mteam_publish_task', {
        goal: '准备验收关闭任务',
        description: '生成一个待关闭任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const closeTaskId = extractDetails(closePublish)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: closeTaskId, agentId: 'maker' });
      harness.mutateTask(closeTaskId, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.lifecycle.phase = 'finalizing';
      });
      const closeResult = await harness.exec('mteam_close_task', {
        taskId: closeTaskId,
        publisher: 'manager',
      }) as ToolResult<{ success: boolean; task?: Record<string, unknown> }>;
      expect(extractDetails(closeResult)?.success).toBe(true);
      expect(harness.readTask(closeTaskId)?.status).toBe('closed');

      const rejectPublish = await harness.exec('mteam_publish_task', {
        goal: '准备驳回任务',
        description: '生成一个待驳回任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const rejectTaskId = extractDetails(rejectPublish)!.taskId;
      const rejectResult = await harness.exec('mteam_reject_task', {
        taskId: rejectTaskId,
        reason: '验收驳回：输出不完整。下一步：补齐缺失字段并重新提交',
      }) as ToolResult<{ task?: Record<string, unknown> }>;
      expect(extractText(rejectResult)).toContain('任务已驳回');
      const rejectedTask = harness.readTask(rejectTaskId);
      expect(rejectedTask?.status).toBe('pending');
      expect(rejectedTask?.description).toBe('补齐缺失字段并重新提交');
      expect(rejectedTask?.context.at(-1)?.step).toContain('验收驳回');
    } finally {
      await harness.cleanup();
    }
  });
});
