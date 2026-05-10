import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end decision hardening e2e', () => {
  test('does not complete from vague completion wording without structured outcome or artifact', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终结论',
        description: '先整理第 1 个候选商品',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '已完成，任务完成。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('running');
      expect(task?.lifecycle.lastDecision).toBe('retain');
    } finally {
      await harness.cleanup();
    }
  });

  test('retains when relay intent exists but next description is empty', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成一轮交接',
        description: '先整理候选结果',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '结果摘要：已整理完候选。下一步：   ' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('running');
      expect(task?.lifecycle.lastDecision).toBe('retain');

      const retainLogs = harness.readLogs(taskId, 'retain');
      expect(retainLogs.at(-1)?.result?.decision).toBe('retain');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails when executor reports blocked state without handoff path or recoverable progress', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成接口验证',
        description: '先调用接口并记录结果',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '问题：接口报错。缺失：调用权限。无法继续。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('BLOCKED_WITH_PROGRESS_BUT_NO_HANDOFF');
    } finally {
      await harness.cleanup();
    }
  });
});
