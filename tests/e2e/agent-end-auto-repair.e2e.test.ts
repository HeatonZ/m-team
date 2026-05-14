import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end business auto-repair e2e', () => {
  test('forces next when llm says complete but unresolved issues still exist', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '当前步骤已完成',
        summary: '已完成本轮产出',
        confidence: 'medium',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成并交付最终结果',
        description: '生成当前步骤报告并保存',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '结果摘要：已生成报告。\nUnresolved issues: missing config file /mnt/d/code/m-team/tasks/config.json' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('修复当前步骤问题');

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm_auto_repair');
      expect(nextLog?.result?.autoRepair?.source).toBe('complete_with_issues');
    } finally {
      await harness.cleanup();
    }
  });

  test('converts recoverable fail into next with repair step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'fail',
        reason: '当前缺少输入文件，无法继续',
        summary: '执行被阻塞',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成数据处理',
        description: '执行当前数据处理步骤',
        taskType: 'data',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: 'Unresolved issues: missing input file /mnt/d/code/m-team/tasks/input.csv' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('修复当前步骤问题');

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm_auto_repair');
      expect(nextLog?.result?.autoRepair?.source).toBe('recoverable_fail');
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps fail when judge marks unrecoverable or manual intervention needed', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'fail',
        reason: 'manual intervention required by business owner',
        summary: '当前缺少上游确认',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成业务执行',
        description: '执行当前业务步骤',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: 'Unresolved issues: waiting for external business approval' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm');
      expect(failLog?.result?.autoRepair ?? null).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('fails when recoverable issue exceeds auto-repair budget', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'fail',
        reason: '当前缺少输入文件，无法继续',
        summary: '执行被阻塞',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成数据处理',
        description: '执行当前数据处理步骤',
        taskType: 'data',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      harness.mutateTask(taskId, (task) => {
        task.context.push(
          {
            type: 'step',
            executor: 'maker',
            step: '第一次修复缺失输入',
            output: {
              summary: '尝试修复',
              unresolvedIssues: ['missing input file /mnt/d/code/m-team/tasks/input.csv'],
              error: 'missing input file /mnt/d/code/m-team/tasks/input.csv',
            },
            completedAt: Date.now() - 2000,
          },
          {
            type: 'step',
            executor: 'maker',
            step: '第二次修复缺失输入',
            output: {
              summary: '再次尝试修复',
              unresolvedIssues: ['missing input file /mnt/d/code/m-team/tasks/input.csv'],
              error: 'missing input file /mnt/d/code/m-team/tasks/input.csv',
            },
            completedAt: Date.now() - 1000,
          },
        );
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: 'Unresolved issues: missing input file /mnt/d/code/m-team/tasks/input.csv' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_auto_repair_budget');
      expect(failLog?.result?.autoRepair?.reason).toBe('AUTO_REPAIR_BUDGET_EXCEEDED_MISSING_INPUT');
    } finally {
      await harness.cleanup();
    }
  });
});
