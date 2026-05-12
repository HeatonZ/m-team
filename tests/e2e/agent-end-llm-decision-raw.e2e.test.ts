import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';
import { judgeAgentEndWithLlm } from '../../src/hooks/agentEndLlm.ts';
import type { Task, ContextStepOutput } from '../../src/schema/task.ts';

describe('agent_end llm raw extraction and empty output handling', () => {
  test('parses decision from final_answer text block via visible text extraction', async () => {
    const runtime = {
      config: { current: () => ({}) },
      agentEndJudge: undefined,
    } as never;

    const task: Task = {
      taskId: 'task_test_visible_text',
      taskType: 'general',
      description: '执行当前步骤',
      goal: '完成任务',
      context: [],
      priority: 'normal',
      publisher: 'manager',
      status: 'running',
      executor: 'maker',
      lastExecutor: null,
      createdAt: Date.now(),
      completedAt: null,
      updatedAt: Date.now(),
    };
    const output: ContextStepOutput = { summary: 'ok', files: [], unresolvedIssues: [] };

    const rawDecision = '{"decision":"next","reason":"还需要下一步","nextDescription":"继续执行下一步","confidence":"high"}';

    const result = await judgeAgentEndWithLlm({
      runtime: {
        ...runtime,
        agentEndJudge: async () => rawDecision,
      } as never,
      cfg: undefined,
      agentId: 'maker',
      task,
      transcript: 'done',
      output,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe('next');
      expect(result.decision.nextDescription).toBe('继续执行下一步');
    }
  });

  test('fails fast with explicit empty-output error when runtime judge returns empty text', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => '';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证空输出失败路径',
        description: '执行一步并记录结果',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '已完成当前步骤' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_fail_fast');
      expect(failLog?.result?.reason).toBe('RUNTIME_AGENT_END_JUDGE_PARSE_FAILED');
      expect(failLog?.result?.llm?.status).toBe('error');
    } finally {
      await harness.cleanup();
    }
  });
});

