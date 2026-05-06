/**
 * TC-H：守卫顺序验证
 * 对应 docs/test-cases/TC-H.md
 * 验证 relayTask/relinquishTask 中 CANCELLED 检查在 executor 检查之前
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

describe('TC-H：守卫顺序验证', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    closeDb();
    setWorkspaceRoot('/tmp/m-team-test-' + process.pid);
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-H1：cancelTask 后 executor 清空，relayTask 应返回 TASK_CANCELLED', () => {
    it('cancelTask 清空 executor 后，relayTask 应返回 TASK_CANCELLED（不是 NOT_CURRENT_EXECUTOR）', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 's', contextOutput: {}, description: 's' });
      const data = extract(result) as { success: boolean; reason: string };
      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'TASK_CANCELLED');
    });
  });

  describe('TC-H2：relinquishTask 守卫顺序同样验证', () => {
    it('cancelTask 清空 executor 后，relinquishTask 应返回 TASK_CANCELLED', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: 'reason' });

      const result = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });
      const data = extract(result) as { success: boolean; reason: string };
      assert.equal((extract(result) as { success: boolean }).success, false);
      assert.equal((extract(result) as { reason: string }).reason, 'TASK_CANCELLED');
    });
  });
});
