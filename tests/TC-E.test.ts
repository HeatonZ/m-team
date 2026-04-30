/**
 * TC-E：放弃任务流程
 * 对应 docs/test-cases/TC-E.md
 * 区别于 relay：relinquish 不追加 context 步骤
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import { createMockApi } from './helpers/testApi.js';
import { closeDb } from '../src/pool/db.js';
import { setWorkspaceRoot } from '../src/pool/operations.js';
import { registerTools } from '../src/tools/index.js';

const NOOP_CONFIG = { notifications: [] };

async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

function extract(result: { ok: boolean; data: unknown }): unknown {
  return result.data;
}

function getTask(result: { ok: boolean; data: unknown }): unknown {
  const data = extract(result) as { task?: unknown; success?: boolean };
  return data.task ?? data;
}

describe('TC-E：放弃任务流程', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    closeDb();
    setWorkspaceRoot('/tmp/m-team-test-' + process.pid);
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-E1：Agent 放弃后另一个 Agent 完成', () => {
    it('relinquish 不追加 context（与 relay 的关键区别）', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      // 先用 updateTask 追加一条上下文（模拟部分工作）
      await callTool(api, 'mteam_update_task', { taskId, contextStep: '做了部分工作', contextOutput: {} });
      const afterUpdate = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { context: unknown[] };
      assert.equal(afterUpdate.context.length, 2);

      const relinquishResult = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });
      assert.equal((extract(relinquishResult) as { success: boolean }).success, true);

      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; executor: string; lastExecutor: string; context: unknown[] };
      assert.equal(task.status, 'pending');
      assert.equal(task.executor, null);
      assert.equal(task.lastExecutor, 'alice');
      assert.equal(task.context.length, 2); // relinquish 不追加，context 不变
    });

    it('bob 接手完成，context 长度只增加 1（bob 的完成步骤）', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_update_task', { taskId, contextStep: '部分工作', contextOutput: {} });
      await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });

      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      const completeResult = await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'bob 完成', contextOutput: {} });

      assert.equal((extract(completeResult) as { success: boolean }).success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; context: unknown[] };
      assert.equal(task.status, 'completed');
      assert.equal(task.context.length, 3); // input + alice部分 + bob完成
    });
  });

  describe('TC-E2：非当前 Executor 放弃失败', () => {
    it('bob 放弃 alice 的任务失败', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const result = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'bob' });
      const data = extract(result) as { success: boolean; reason: string };
      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'NOT_CURRENT_EXECUTOR');
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { executor: string; status: string };
      assert.equal(task.executor, 'alice');
      assert.equal(task.status, 'running');
    });
  });

  describe('TC-E3：CANCELLED 任务不可放弃', () => {
    it('已取消的任务 relinquishment 失败', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });
      const data = extract(result) as { success: boolean; reason: string };
      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'TASK_CANCELLED');
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string };
      assert.equal(task.status, 'cancelled');
    });
  });
});
