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
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '第一步已完成，但还需要继续后续计算步骤。',
        nextDescription: '计算 1×1，并写入 /mnt/d/code/hermes/step2.json',
        nextTaskType: 'general',
        summary: '已完成 1+1，并生成 step1.json。',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，并输出三个结果',
        description: '计算 1+1，并写入 /mnt/d/code/hermes/step1.json',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '结果摘要：已完成计算 1+1。产出文件：/mnt/d/code/hermes/step1.json。数据引用：step1.json 记录 1+1=2。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('1×1');
      expect(task?.context.at(-1)?.output?.files).toContain('/mnt/d/code/hermes/step1.json');
    } finally {
      await harness.cleanup();
    }
  });

  test('completes only when final artifact is present and transcript explicitly ties result to overall goal completion', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终结果文件已生成，整体目标已完成。',
        summary: '已生成最终汇总文件 result.json。',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成 1+1、1×1、2+3 三个计算，并输出三个结果',
        description: '汇总三个计算结果并输出最终文件',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '最终结果：已完成 1+1、1×1、2+3 三个计算并汇总输出。产出文件：/mnt/d/code/hermes/result.json。数据引用：result.json 包含三个结果 2、1、5，任务完成。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.context.at(-1)?.output?.files).toContain('/mnt/d/code/hermes/result.json');
    } finally {
      await harness.cleanup();
    }
  });

  test('completes when judge confirms final work is done and publisher acceptance remains external', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终汇总已完成，任务进入待 publisher 验收状态。',
        summary: '所有计算步骤已完成，final_result.md 汇总结果为 8。',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '三个 agent 协作完成计算并输出最终结果 8',
        description: '汇总三个子任务结果并验证总和为 8',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      harness.mutateTask(taskId, (task) => {
        task.context.push({
          type: 'step',
          executor: 'scholar',
          step: '生成最终结果',
          output: {
            summary: '所有计算步骤已完成，final_result.md 汇总结果为 8',
            files: ['final_result.md', 'step1_result.md', 'step2_result.md', 'step3_result.md'],
            unresolvedIssues: [],
          },
          completedAt: Date.now(),
        });
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '所有计算步骤已完成，final_result.md 汇总结果为 8。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
    } finally {
      await harness.cleanup();
    }
  });
});
