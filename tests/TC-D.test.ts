/**
 * TC-D：取消任务流程
 * 对应 docs/test-cases/TC-D.md
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

describe('TC-D：取消任务流程', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-D1：Publisher 取消 Running 任务', () => {
    it('Publisher 取消 Running 任务成功，状态变为 CANCELLED', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: '优先级调整' });

      assert.equal((extract(result) as { success: boolean }).success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; completedAt: number | null; executor: string };
      assert.equal(task.status, 'cancelled');
      assert.notEqual(task.completedAt, null);
      assert.equal(task.executor, null);
    });

    it('取消后 bob 认领失败，任务不是待认领状态', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'NOT_PENDING');
    });
  });

  describe('TC-D2：非 Publisher 无法取消', () => {
    it('非发布者取消失败', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g', publisher: 'boss' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'other_user', reason: 'reason' });

      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'NOT_PUBLISHER');
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; executor: string };
      assert.equal(task.status, 'running');
      assert.equal(task.executor, 'alice');
    });
  });

  describe('TC-D3：取消尚未被认领的 PENDING 任务', () => {
    it('直接取消 PENDING 任务成功', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;

      const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      assert.equal((extract(result) as { success: boolean }).success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; executor: string };
      assert.equal(task.status, 'cancelled');
      assert.equal(task.executor, null);
    });
  });

  describe('TC-D4：终态任务不可再取消', () => {
    it('已取消的任务再次取消失败', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason1' });

      const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason2' });

      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'ALREADY_TERMINAL');
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string };
      assert.equal(task.status, 'cancelled');
    });
  });

  describe('TC-D5：Relay 后任务被取消', () => {
    it('relay 后 Publisher 取消，alice 的上下文记录保留', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 'alice_step', contextOutput: {} });

      const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      assert.equal((extract(result) as { success: boolean }).success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; context: unknown[] };
      assert.equal(task.status, 'cancelled');
      assert.equal(task.context.length, 2);
      assert.equal((task.context[1] as { step: string }).step, 'alice_step');

      // bob 无法认领已取消任务
      const r2 = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      assert.equal((extract(r2) as { success: boolean }).success, false);
    });
  });
});
