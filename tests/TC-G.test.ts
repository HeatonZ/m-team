/**
 * TC-G：并发场景
 * 对应 docs/test-cases/TC-G.md
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

describe('TC-G：并发场景', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-G1：两个 Agent 同时认领同一任务', () => {
    it('并发 claimTask 只有一个成功，另一个失败', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;

      const result1 = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      const result2 = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });

      const r1 = extract(result1) as { success: boolean; reason?: string };
      const r2 = extract(result2) as { success: boolean; reason?: string };
      const successes = [r1, r2].filter(r => r.success);
      const failures = [r1, r2].filter(r => !r.success);

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(failures[0]!.reason, 'NOT_PENDING');

      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { executor: string };
      const winner = r1.success ? 'alice' : 'bob';
      assert.equal(task.executor, winner);
    });
  });

  describe('TC-G2：Agent 已有活跃任务不再分配新任务', () => {
    it('alice 有活跃任务时 getPendingTasks(alice) 返回空', async () => {
      const pubResult1 = await callTool(api, 'mteam_publish_task', { description: 't1', goal: 'g' });
      const taskId1 = (extract(pubResult1) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId: taskId1, agentId: 'alice' });

      const pendingResult = await callTool(api, 'mteam_get_pending', { agentId: 'alice' });
      const pending = (extract(pendingResult) as { pending: unknown[] }).pending;
      assert.equal(pending.length, 0);
    });

    it('alice 有活跃任务时 bob 仍能正常获取待认领任务', async () => {
      const pubResult1 = await callTool(api, 'mteam_publish_task', { description: 't1', goal: 'g' });
      const pubResult2 = await callTool(api, 'mteam_publish_task', { description: 't2', goal: 'g' });
      const taskId1 = (extract(pubResult1) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId: taskId1, agentId: 'alice' });

      const pendingResult = await callTool(api, 'mteam_get_pending', { agentId: 'bob' });
      const pending = (extract(pendingResult) as { pending: unknown[] }).pending;
      assert.ok(pending.length >= 1);
    });

    it('alice 有活跃任务时再次认领新任务仍成功（系统允许多任务）', async () => {
      const pubResult1 = await callTool(api, 'mteam_publish_task', { description: 't1', goal: 'g' });
      const pubResult2 = await callTool(api, 'mteam_publish_task', { description: 't2', goal: 'g' });
      const taskId1 = (extract(pubResult1) as { taskId: string }).taskId;
      const taskId2 = (extract(pubResult2) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId: taskId1, agentId: 'alice' });

      const result = await callTool(api, 'mteam_claim_task', { taskId: taskId2, agentId: 'alice' });
      assert.equal((extract(result) as { success: boolean }).success, true);
    });
  });
});
