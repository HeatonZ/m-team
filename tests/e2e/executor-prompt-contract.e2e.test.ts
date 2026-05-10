import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('executor prompt contract e2e', () => {
  test('claim-launched executor prompt should require structured final report with step result, issues, and overall-goal status', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '先整理 3 个候选商品信息',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' }) as ToolResult<{ sessionKey: string }>;
      const claimText = extractText(claimResult);

      expect(claimText).toContain('当前步骤');
      expect(claimText).not.toContain('目标:');

      const runMessage = harness.readSubagentRuns().at(-1)?.message ?? '';
      expect(runMessage).toContain('最后一条消息必须结构化汇报 4 件事');
      expect(runMessage).toContain('结果摘要');
      expect(runMessage).toContain('未解决问题');
      expect(runMessage).toContain('如果没有下一步，要说明为什么整个任务已满足 goal');
      expect(runMessage).toContain('本步完成 ≠ 整任务完成');
      expect(runMessage).not.toContain('目标: 形成最终选品结论');
    } finally {
      await harness.cleanup();
    }
  });
});
