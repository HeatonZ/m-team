import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end conservative fallback e2e', () => {
  test('fails when messages are empty', async () => {
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
          messages: [],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('AGENT_END_MESSAGES_EMPTY');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails when executor session exits with error', async () => {
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
          success: false,
          error: 'HTTP_500',
          messages: [{ role: 'assistant', content: '调用失败' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('HTTP_500');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails conservatively when llm parse fails and there is no recoverable progress', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

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
          messages: [{ role: 'assistant', content: '' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('conservative_fallback');
    } finally {
      await harness.cleanup();
    }
  });

  test('returns next conservatively when llm parse fails but transcript already reports a clear next problem to solve', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '产出可验证的最终结果文件',
        description: '补齐最终校验文件',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '还需补齐校验文件并重试一次生成流程。' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description?.length ?? 0).toBeLessThan(80);
      expect(task?.description).not.toContain('本轮报告的问题推进下一步修复动作');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('conservative_fallback');
      expect(['LLM_UNAVAILABLE_BUT_PROBLEM_REPORTED', 'LLM_UNAVAILABLE_WITH_PARTIAL_PROGRESS']).toContain(nextLog?.result?.reason);
    } finally {
      await harness.cleanup();
    }
  });

  test('fails instead of looping when llm is unavailable and the same step is already done with no real unresolved issue', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => null;

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成三步计算并最终汇总',
        description: '计算 1+1，结果写入 step1_result.md',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '结果摘要：计算 1+1 = 2，已写入 step1_result.md。\n产出文件：step1_result.md\n未解决问题：无' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(['repeat_guard', 'conservative_fallback']).toContain(failLog?.result?.via);
    } finally {
      await harness.cleanup();
    }
  });

  test('rescues nextDescription from a partial llm payload instead of falling back to the current step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () =>
        '{"decision":"next","reason":"当前步骤已完成，需要进入下一步","nextDescription":"计算 1×1=1，将结果写入 step2_result.md","nextStepContract":{"expectedOutcome":"得到 1×1=1 的计算结果","doneWhen":["step2_result.md 已生成并包含 1×1=1"]}';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成三步计算并最终汇总',
        description: '计算 1+1，结果写入 step1_result.md',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '结果摘要：1+1=2，已写入 step1_result.md。下一步：计算 1×1=1，将结果写入 step2_result.md' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toContain('计算 1×1=1');

      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
      expect(nextLog?.result?.llm?.source).toBe('llm');
      expect(nextLog?.result?.llm?.status).toBe('ok');
      expect(nextLog?.result?.llm?.parsed?.nextDescription).toContain('计算 1×1=1');
      expect(nextLog?.result?.fallback).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
