import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('after_tool_call logging e2e', () => {
  test('writes publish, claim, and cancel logs with structured params/results', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证 task log 记录',
        description: '创建一个可取消的测试任务',
        taskType: 'general',
        publisher: 'manager',
        priority: 'high',
      }, { agentId: 'manager', sessionKey: 'agent:manager:manual' }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'maker',
      }, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` }) as ToolResult<{ task?: { taskId?: string } }>;
      expect(extractDetails(claimResult)?.task?.taskId).toBe(taskId);

      await harness.exec('mteam_cancel_task', {
        taskId,
        publisher: 'manager',
        reason: '测试取消',
      }, { agentId: 'manager', sessionKey: 'agent:manager:manual' });

      const logs = harness.readLogs(taskId);
      expect(logs.map((item) => item.action)).toEqual(['cancel', 'claim', 'publish']);

      const publishLog = logs.find((item) => item.action === 'publish');
      expect(publishLog?.agentId).toBe('manager');
      expect(publishLog?.params).toMatchObject({
        description: '创建一个可取消的测试任务',
        goal: '验证 task log 记录',
        priority: 'high',
      });
      expect(publishLog?.result).toMatchObject({
        details: { taskId },
      });

      const claimLog = logs.find((item) => item.action === 'claim');
      expect(claimLog?.agentId).toBe('maker');
      expect(claimLog?.params).toMatchObject({ taskId, agentId: 'maker' });
      expect(claimLog?.result?.details?.taskId).toBe(taskId);
      expect(claimLog?.result?.details?.runId).toBe('test-run-id');
      expect(claimLog?.result?.details?.sessionKey).toMatch(new RegExp(`^agent:maker:m-team:${taskId}:[^:]+$`));

      const cancelLog = logs.find((item) => item.action === 'cancel');
      expect(cancelLog?.agentId).toBe('manager');
      expect(cancelLog?.params).toMatchObject({ taskId, publisher: 'manager', reason: '测试取消' });
      expect(cancelLog?.result).toMatchObject({
        details: { success: true },
      });
    } finally {
      await harness.cleanup();
    }
  });
});
