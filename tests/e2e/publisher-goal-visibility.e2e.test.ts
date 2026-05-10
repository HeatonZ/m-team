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
        description: '先计算 1+1',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/result.md，三个算式已全部完成。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const closeResult = await harness.exec('mteam_close_task', { taskId, publisher: 'manager' }, { agentId: 'manager' });
      const closeText = extractText(closeResult);
      expect(closeText).toContain('目标: 完成 3 个算式并汇总到最终结果');
      expect(closeText).toContain('当前步骤: 先计算 1+1');

      const publishAgain = await harness.exec('mteam_publish_task', {
        goal: '完成 5 个候选商品复核并给出结论',
        description: '先复核第 1 个候选商品',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId2 = extractDetails(publishAgain)!.taskId;

      await harness.exec('mteam_claim_task', { taskId: taskId2, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '结果摘要：第 1 个候选已复核。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId2}` },
      );

      const rejectResult = await harness.exec(
        'mteam_reject_task',
        { taskId: taskId2, reason: '验收驳回：证据不足。下一步：补齐价格对比和销量截图' },
        { agentId: 'manager' },
      );
      const rejectText = extractText(rejectResult);
      expect(rejectText).toContain('目标: 完成 5 个候选商品复核并给出结论');
      expect(rejectText).toContain('当前步骤: 补齐价格对比和销量截图');
    } finally {
      await harness.cleanup();
    }
  });
});
