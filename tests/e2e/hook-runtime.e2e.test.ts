import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('hook runtime e2e', () => {
  test('heartbeat injects claim prompt only for idle executor and publisher acceptance prompt for publisher', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const idleHeartbeat = harness.runHeartbeat('maker');
      expect(idleHeartbeat?.appendContext).toContain('mteam_get_pending');

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '完成一轮链式交接',
        description: '整理候选商品的初步结果',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      expect(harness.runHeartbeat('maker')).toBeUndefined();

      const publisherHeartbeat = harness.runHeartbeat('manager');
      expect(publisherHeartbeat?.appendContext).toContain('Publisher');
      expect(publisherHeartbeat?.appendContext).toContain('mteam_get_all_tasks');
    } finally {
      await harness.cleanup();
    }
  });

  test('session guard blocks forbidden heartbeat / executor / non-publisher actions', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    const { api } = harness;
    try {
      const publishBlocked = await harness.exec(
        'mteam_publish_task',
        {
          goal: '记录一次被 heartbeat 拦截的发布尝试',
          description: '记录 heartbeat 发布尝试',
          publisher: 'manager',
        },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ blocked?: boolean; reason?: string }>;
      expect(extractDetails(publishBlocked)?.blocked).toBe(true);
      expect(extractText(publishBlocked)).toContain('heartbeat');

      const spawnGuard = api.__hooks.before_tool_call
        .map((hook) => hook({ toolName: 'sessions_spawn', params: { label: 'heartbeat-should-not-spawn', task: '不应在 heartbeat 中派生执行' } } as never, { agentId: 'maker', sessionKey: 'agent:maker:discord:heartbeat' } as never))
        .find(Boolean) as { block?: boolean; blockReason?: string } | undefined;
      expect(spawnGuard?.block).toBe(true);

      const sendGuard = api.__hooks.before_tool_call
        .map((hook) => hook({ toolName: 'sessions_send', params: { sessionId: 'fake-session', message: '不应在 heartbeat 转发未校验结果' } } as never, { agentId: 'maker', sessionKey: 'agent:maker:discord:heartbeat' } as never))
        .find(Boolean) as { block?: boolean; blockReason?: string } | undefined;
      expect(sendGuard?.block).toBe(true);

      const task = await harness.exec('mteam_publish_task', {
        goal: '生成 executor 受限场景',
        description: '执行当前一步并记录结果',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(task)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      const relinquishBlocked = await harness.exec(
        'mteam_relinquish_task',
        { taskId, reason: '不允许 executor 主动 relinquish' },
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      ) as ToolResult<{ blocked?: boolean }>;
      expect(extractDetails(relinquishBlocked)?.blocked).toBe(true);

      const nextBlocked = await harness.exec(
        'mteam_next_task',
        {
          taskId,
          agentId: 'maker',
          contextStep: '执行当前步骤',
          description: '不应由 executor 主动推进下一步',
        },
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      ) as ToolResult<{ blocked?: boolean }>;
      expect(extractDetails(nextBlocked)?.blocked).toBe(true);

      const closeBlocked = await harness.exec(
        'mteam_close_task',
        { taskId, publisher: 'manager' },
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      ) as ToolResult<{ blocked?: boolean }>;
      expect(extractDetails(closeBlocked)?.blocked).toBe(true);
      expect(extractText(closeBlocked)).toContain('无权操作');
    } finally {
      await harness.cleanup();
    }
  });

  test('agent_end returns the task to the pool with next description and later completes when final result is present', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '形成最终候选结论',
        description: '整理 3 个候选商品信息',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: '还需继续补齐剩余候选。',
        nextDescription: '继续搜索宠物玩具，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8，补齐剩余 3 个。',
        summary: '已完成首轮筛选，保留 2 个候选。',
        confidence: 'high',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '结果摘要：已完成首轮筛选，保留 2 个候选。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      const nextTask = harness.readTask(taskId);
      expect(nextTask?.status).toBe('pending');
      expect(nextTask?.description).toContain('继续搜索宠物玩具');
      expect(nextTask?.context.at(-1)?.output?.summary).toContain('已完成首轮筛选');

      await harness.exec('mteam_claim_task', { taskId, agentId: 'fixer' }, { agentId: 'fixer' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终结果已形成',
        summary: '已输出最终结果文件',
        confidence: 'high',
      });
      await harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/result.md，形成最终候选结论，任务完成。' },
          ],
        } as never,
        { agentId: 'fixer', sessionKey: `agent:fixer:m-team:${taskId}:test-session` },
      );

      const completedTask = harness.readTask(taskId);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.context.at(-1)?.output?.files).toContain('/mnt/d/code/hermes/result.md');
    } finally {
      await harness.cleanup();
    }
  });

  test('agent_end ignores non-task storage prefixes and no longer crashes on publisher timeout scan', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证超时扫描兼容 storage.list',
        description: '整理 1 个候选商品信息',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: '最终结果已形成',
        summary: '已输出最终结果文件',
        confidence: 'high',
      });

      await expect(harness.runAgentEnd(
        {
          success: true,
          messages: [
            { role: 'assistant', content: '最终结果：已输出 /mnt/d/code/hermes/result.md，形成最终候选结论，任务完成。' },
          ],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      )).resolves.toBeUndefined();

      expect(harness.readTask(taskId)?.status).toBe('completed');
    } finally {
      await harness.cleanup();
    }
  });
});
