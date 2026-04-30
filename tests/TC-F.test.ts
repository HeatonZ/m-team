/**
 * TC-F：Cancelled 任务的宽容处理
 * 对应 docs/test-cases/TC-F.md
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import { createMockApi } from './helpers/testApi.js';
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

describe('TC-F：Cancelled 任务的宽容处理', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-F1：Cancelled 任务允许追加上下文', () => {
    it('cancel 后 updateTask 追加 context 成功，状态保持 CANCELLED', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const updatedResult = await callTool(api, 'mteam_update_task', { taskId, contextStep: '事后通知用户', contextOutput: {} });
      const updated = getTask(updatedResult) as { status: string; context: unknown[] };

      assert.equal(updated.status, 'cancelled');
      assert.equal(updated.context.length, 2);
    });
  });

  describe('TC-F2：Cancelled 任务拒绝 Relay', () => {
    it('cancel 后 relayTask 失败，返回 TASK_CANCELLED', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 's', contextOutput: {} });

      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'TASK_CANCELLED');
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string };
      assert.equal(task.status, 'cancelled');
    });
  });

  describe('TC-F3：Cancelled 任务拒绝 Complete', () => {
    it('cancel 后 completeTask 失败，任务保持 CANCELLED', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'done', contextOutput: {} });

      assert.equal((extract(result) as { success: boolean }).success, false);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string };
      assert.equal(task.status, 'cancelled');
    });
  });
});
