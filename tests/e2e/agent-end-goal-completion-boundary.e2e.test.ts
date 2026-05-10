import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('agent_end task-goal completion boundary', () => {
  test('does not complete when current step is done with artifact but overall goal still implies remaining work', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，输出三个结果',
        description: '计算 1+1，并写入 /mnt/d/code/hermes/step1.json',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '结果摘要：已完成计算 1+1。产出文件：/mnt/d/code/hermes/step1.json。数据引用：step1.json 中记录 1+1=2。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('running');
      expect(task?.lifecycle.lastDecision).toBe('retain');
      expect(task?.context.at(-1)?.output?.files).toContain('/mnt/d/code/hermes/step1.json');
    } finally {
      await harness.cleanup();
    }
  });

  test('completes only when final artifact is present and transcript explicitly ties result to overall goal completion', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，输出三个结果',
        description: '汇总三个计算结果并输出最终文件',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '最终结果：已完成 1+1、1×1、2+3 三个计算并汇总输出。产出文件：/mnt/d/code/hermes/result.json。数据引用：result.json 包含三个结果 2、1、5。任务完成。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.context.at(-1)?.output?.files).toContain('/mnt/d/code/hermes/result.json');
    } finally {
      await harness.cleanup();
    }
  });
});
