/**
 * TC-B：中转交接流程（工具层测试）
 * 对应 docs/test-cases/TC-B.md
 * 测试策略：通过 mockApi + registerTools 调用 mteam_* 工具接口
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import { createMockApi } from './helpers/mockApi.js';
import { registerTools } from '../src/tools/index.js';

const NOOP_CONFIG = { notifications: [] };

async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

function extract(result: { ok: boolean; data: unknown }): unknown {
  return result.ok ? result.data : result;
}

function getTask(result: { ok: boolean; data: unknown }): unknown {
  const data = extract(result) as { task?: unknown; success?: boolean };
  return data.task ?? data;
}

describe('TC-B：中转交接流程', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-B1：单次 Relay', () => {
    it('alice relay 后任务变为待认领，lastExecutor 记录为 alice', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const relayResult = await callTool(api, 'mteam_relay_task', {
        taskId, agentId: 'alice',
        contextStep: '第一步',
        contextOutput: { summary: 'done' }
      });
      const relayData = extract(relayResult) as { success: boolean; task: unknown };
      const task = relayData.task as { status: string; executor: string | null; lastExecutor: string; context: unknown[] };

      assert.equal(relayData.success, true);
      assert.equal(task.status, 'pending');
      assert.equal(task.executor, null);
      assert.equal(task.lastExecutor, 'alice');
      assert.equal(task.context.length, 2);
    });

    it('bob 认领 relay 后的任务', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: '第一步', contextOutput: {} });

      const claimResult = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      const claimData = extract(claimResult) as { success: boolean; task: { executor: string; lastExecutor: string } };

      assert.equal(claimData.success, true);
      assert.equal(claimData.task.executor, 'bob');
      assert.equal(claimData.task.lastExecutor, 'alice');
    });

    it('bob 完成，context 长度 = alice_input(1) + alice_step1(1) + bob_final(1) = 3', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: '第一步', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });

      const completeResult = await callTool(api, 'mteam_complete_task', {
        taskId,
        contextStep: '完成',
        contextOutput: {}
      });
      const task = getTask(completeResult) as { status: string; context: unknown[] };

      assert.equal(task.status, 'completed');
      assert.equal(task.context.length, 3);
      assert.equal((task.context[1] as { step: string }).step, '第一步');
      assert.equal((task.context[2] as { step: string }).step, '完成');
    });
  });

  describe('TC-B2：多次 Relay（alice → bob → carol）', () => {
    it('三轮 relay 后完成，context 长度 = 4', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;

      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 'alice_step1', contextOutput: {} });

      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'bob', contextStep: 'bob_step1', contextOutput: {} });

      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'carol' });
      await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'carol_final', contextOutput: {} });

      const taskResult = await callTool(api, 'mteam_get_task', { taskId });
      const task = getTask(taskResult) as { status: string; context: unknown[] };

      assert.equal(task.status, 'completed');
      assert.equal(task.context.length, 4);
      assert.equal((task.context[1] as { step: string }).step, 'alice_step1');
      assert.equal((task.context[2] as { step: string }).step, 'bob_step1');
      assert.equal((task.context[3] as { step: string }).step, 'carol_final');
      assert.equal((task.context[1] as { executor: string }).executor, 'alice');
      assert.equal((task.context[2] as { executor: string }).executor, 'bob');
      assert.equal((task.context[3] as { executor: string }).executor, 'carol');
    });
  });

  describe('TC-B3：Relay 后旧 Session 结束', () => {
    it('relay 后旧 session 再调用 completeTask 失败，任务保持 pending', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 'done', contextOutput: {} });

      // alice 的旧 session 窗口调用 completeTask
      const completeResult = await callTool(api, 'mteam_complete_task', {
        taskId,
        contextStep: 'old_session_complete',
        contextOutput: {}
      });
      const completeData = extract(completeResult) as { success: boolean; reason?: string };

      assert.equal(completeData.success, false);
      assert.ok(completeData.reason !== undefined && completeData.reason.startsWith('TASK_NOT_RUNNING'));

      const taskResult = await callTool(api, 'mteam_get_task', { taskId });
      const task = getTask(taskResult) as { status: string; context: unknown[] };

      assert.equal(task.status, 'pending');
      assert.equal(task.context.length, 2); // relay 的记录未被覆盖
      assert.equal((task.context[1] as { step: string }).step, 'done');
    });
  });
});
