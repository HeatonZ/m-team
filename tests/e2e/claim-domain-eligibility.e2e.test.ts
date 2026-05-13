import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('claim domain eligibility e2e', () => {
  test('scholar cannot claim cross-border ecommerce tasks', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '在妙手ERP采集箱完成跨境上架准备',
        description: '打开1688商品详情并生成英文listing',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'scholar',
      }) as ToolResult<{ success?: boolean; reason?: string }>;

      const text = extractText(claimResult);
      const details = extractDetails(claimResult);

      expect(text).toContain('AGENT_TASK_DOMAIN_MISMATCH');
      expect(details?.success).toBe(false);
      expect(details?.reason).toContain('AGENT_TASK_DOMAIN_MISMATCH');

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.executor).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('scholar pending list excludes cross-border ecommerce tasks', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      await harness.exec('mteam_publish_task', {
        goal: 'ERP上架',
        description: '处理1688商品并生成listing',
        publisher: 'manager',
      });
      await harness.exec('mteam_publish_task', {
        goal: '整理通用会议纪要',
        description: '汇总昨日会议重点',
        publisher: 'manager',
      });

      const pendingScholar = await harness.exec('mteam_get_pending', { agentId: 'scholar' }) as ToolResult<{ pending?: Array<{ description?: string }> }>;
      const pendingMaker = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<{ pending?: Array<{ description?: string }> }>;

      const scholarList = extractDetails(pendingScholar)?.pending ?? [];
      const makerList = extractDetails(pendingMaker)?.pending ?? [];

      expect(scholarList.length).toBe(1);
      expect(scholarList[0]?.description).toContain('会议');
      expect(makerList.length).toBe(2);
    } finally {
      await harness.cleanup();
    }
  });
});

