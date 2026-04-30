/**
 * TC-J：优先级调度
 * 对应 docs/test-cases/TC-J.md
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

describe('TC-J：优先级调度', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-J1：高优先级任务优先返回', () => {
    it('getPendingTasks 返回顺序：high > normal > low', async () => {
      await callTool(api, 'mteam_publish_task', { description: 'normal任务', goal: 'g', priority: 'normal' });
      await callTool(api, 'mteam_publish_task', { description: 'high任务', goal: 'g', priority: 'high' });
      await callTool(api, 'mteam_publish_task', { description: 'low任务', goal: 'g', priority: 'low' });

      const pendingResult = await callTool(api, 'mteam_get_pending', {});
      const pending = (extract(pendingResult) as { pending: { priority: string }[] }).pending;

      assert.ok(pending.length >= 3);
      const priorities = pending.map(t => t.priority);
      const highIdx = priorities.indexOf('high');
      const normalIdx = priorities.indexOf('normal');
      const lowIdx = priorities.indexOf('low');
      assert.ok(highIdx < normalIdx, 'high 应在 normal 之前');
      assert.ok(normalIdx < lowIdx, 'normal 应在 low 之前');
    });
  });

  describe('TC-J2：同一优先级按创建时间先来先服务', () => {
    it('同优先级按 createdAt 升序返回', async () => {
      const r1 = await callTool(api, 'mteam_publish_task', { description: '先发', goal: 'g', priority: 'normal' });
      const r2 = await callTool(api, 'mteam_publish_task', { description: '后发', goal: 'g', priority: 'normal' });
      const taskId1 = (extract(r1) as { taskId: string }).taskId;
      const taskId2 = (extract(r2) as { taskId: string }).taskId;

      const pendingResult = await callTool(api, 'mteam_get_pending', {});
      const pending = (extract(pendingResult) as { pending: { taskId: string }[] }).pending;
      const ids = pending.map(t => t.taskId);

      assert.ok(ids.indexOf(taskId1) < ids.indexOf(taskId2), '先发的任务应在前');
    });
  });
});
