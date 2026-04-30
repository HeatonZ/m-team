/**
 * TC-C：任务失败流程
 * 对应 docs/test-cases/TC-C.md
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import { createMockApi } from './helpers/testApi.js';
import { closeDb } from '../src/pool/db.js';
import { setWorkspaceRoot } from '../src/pool/operations.js';
import { registerTools } from '../src/tools/index.js';
import { failTask } from '../src/pool/operations.js';

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

describe('TC-C：任务失败流程', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    closeDb();
    setWorkspaceRoot('/tmp/m-team-test-' + process.pid);
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-C1：Agent 执行失败并标记失败', () => {
    it('alice 失败，任务状态变为 failed', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const result = failTask(taskId, '网络不可达', null, {
        outcome: '网络不可达',
        output: { error: '网络不可达' }
      });

      assert.equal(result.success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; completedAt: number | null; executor: string; context: unknown[] };
      assert.equal(task.status, 'failed');
      assert.notEqual(task.completedAt, null);
      assert.equal(task.executor, null);
      assert.equal(task.context.length, 2);
    });

    it('查询确认状态为失败、完成时间不为空', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      failTask(taskId, '网络不可达', null, { outcome: 'error', output: { error: '网络不可达' } });

      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; completedAt: number | null };
      assert.equal(task.status, 'failed');
      assert.notEqual(task.completedAt, null);
    });
  });

  describe('TC-C2：失败后再次调用失败', () => {
    it('再次调用 failTask 失败，任务状态保持 failed', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      failTask(taskId, 'error1', null, { outcome: 'error', output: {} });

      const result = failTask(taskId, 'error2', null, { outcome: 'error', output: {} });

      assert.equal(result.success, false);
      assert.ok(result.reason !== undefined && result.reason.startsWith('TASK_NOT_RUNNING'));
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string };
      assert.equal(task.status, 'failed');
    });
  });

  describe('TC-C3：认领后未开始直接失败', () => {
    it('不传 contextEntry 直接 failTask，context 长度仍为 1', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const result = failTask(taskId, '无法执行');

      assert.equal(result.success, true);
      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { status: string; context: unknown[] };
      assert.equal(task.status, 'failed');
      assert.equal(task.context.length, 1); // 无中间步骤
    });
  });
});
