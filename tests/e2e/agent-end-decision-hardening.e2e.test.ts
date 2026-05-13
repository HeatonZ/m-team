import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end llm fail-fast e2e', () => {
  test('fails when messages are empty', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Produce a final report',
        description: 'Draft the first section',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        { success: true, messages: [] } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
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
        goal: 'Verify the API response',
        description: 'Record the API response and save the output',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: false,
          error: 'HTTP_500',
          messages: [{ role: 'assistant', content: 'Execution failed' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.context.at(-1)?.output?.error).toBe('HTTP_500');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails fast when the llm decision cannot be parsed and there is no recovered decision', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify the API response',
        description: 'Record the API response and save the output',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_fail_fast');
      expect(failLog?.result?.reason).toBe('RUNTIME_AGENT_END_JUDGE_PARSE_FAILED');
      expect(failLog?.result?.llm?.source).toBe('llm');
      expect(failLog?.result?.llm?.status).toBe('error');
      expect(failLog?.result?.fallback).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  test('fails fast when llm is unavailable and the same step is already done with no real unresolved issue', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => null;

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Complete three calculation steps and summarize the final result',
        description: 'Calculate 1+1 and write the result to step1_result.md',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: 'Summary: 1+1 = 2, written to step1_result.md.\nFiles: step1_result.md\nUnresolved issues: none' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_fail_fast');
      expect(failLog?.result?.reason).toBe('RUNTIME_AGENT_END_JUDGE_EMPTY');
    } finally {
      await harness.cleanup();
    }
  });

  test('rescues nextDescription from a partial llm payload instead of failing', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () =>
        '{"decision":"next","reason":"当前步骤已完成，需要进入下一步","nextDescription":"计算 1×1=1，将结果写入 step2_result.md","nextStepContract":{"expectedOutcome":"得到 1×1=1 的计算结果","doneWhen":["step2_result.md 已生成并包含 1×1=1"]}';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成三步计算并最终汇总',
        description: '计算 1+1，结果写入 step1_result.md',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: '结果摘要：1+1=2，已写入 step1_result.md。下一步：计算 1×1=1，将结果写入 step2_result.md' }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
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
