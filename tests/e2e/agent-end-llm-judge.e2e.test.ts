import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('agent_end llm judge e2e', () => {
  test('uses llm decision complete when judge returns complete', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '整体 goal 已满足',
        summary: '已形成最终结果',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '整理最终结果并结束',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已整理完成。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('completed');
      const completeLog = harness.readLogs(taskId, 'complete').at(-1);
      expect(completeLog?.result?.via).toBe('llm');
    } finally {
      await harness.cleanup();
    }
  });

  test('uses llm decision next with nextDescription', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '还需下一棒继续',
        nextDescription: '继续补齐剩余 3 个候选商品',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '找够 5 个候选商品',
        description: '先整理首批候选',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已保留 2 个候选。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toBe('继续补齐剩余 3 个候选商品');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
    } finally {
      await harness.cleanup();
    }
  });

  test('uses llm decision next and returns task to pending with the next description', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '把本轮发现的问题转成下一步处理动作',
        nextDescription: '补齐当前步骤缺失的结构化结果后重新提交',
        summary: '已完成初步整理，但证据不足',
        confidence: 'medium',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终结论',
        description: '先整理第 1 个候选商品',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已完成初步整理。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toBe('补齐当前步骤缺失的结构化结果后重新提交');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
    } finally {
      await harness.cleanup();
    }
  });

  test('fails fast when llm judge parse fails', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => 'not-json';

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '先整理 3 个候选商品信息',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已保留 2 个候选，记录在 /mnt/d/code/hermes/result.md。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_fail_fast');
      expect(failLog?.result?.llm?.status).toBe('error');
      const warns = harness.readRuntimeLogs().filter(log => log.level === 'warn').map(log => log.message).join('\n');
      expect(warns).toContain('agent_end llm judge failed');
    } finally {
      await harness.cleanup();
    }
  });

  test('uses next when judge turns reported problems into the next step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '继续补齐本轮报告缺失的校验文件，并重新提交可验证结果',
        nextDescription: '继续补齐本轮报告缺失的校验文件，并重新提交可验证结果',
        summary: '已完成初步产出，但还需补一份校验文件',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终选品结论',
        description: '整理候选并补齐校验文件',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：已整理候选列表，但还需补齐一份校验文件后才能提交。' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.executor).toBeNull();
      expect(task?.description).toBe('整理候选并补齐校验文件');
      const nextLog = harness.readLogs(taskId, 'next').at(-1);
      expect(nextLog?.result?.via).toBe('llm');
      expect(nextLog?.result?.nextDescription).toBe('整理候选并补齐校验文件');
    } finally {
      await harness.cleanup();
    }
  });

  test('ignores llm next when it repeats the current step and there is no real unresolved issue', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '继续当前步骤',
        nextDescription: '计算 1+1，结果写入 step1_result.md',
        confidence: 'medium',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成三步计算并最终汇总',
        description: '计算 1+1，结果写入 step1_result.md',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{ role: 'assistant', content: '结果摘要：计算 1+1 = 2，已写入 step1_result.md。\n产出文件：step1_result.md\n未解决问题：无' }],
      } as never, { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` });

      const task = harness.readTask(taskId);
      expect(task?.status).toBe('failed');
      const failLog = harness.readLogs(taskId, 'fail').at(-1);
      expect(failLog?.result?.via).toBe('llm_repeat_guard');
    } finally {
      await harness.cleanup();
    }
  });
});
