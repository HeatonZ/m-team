/**
 * TC-K：db.js 底层
 * 对应 docs/test-cases/TC-K.md
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import { openDb, closeDb, getDb } from '../src/pool/db.js';
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

describe('TC-K：db.js 底层', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-K1：context 嵌套对象序列化正确', () => {
    it('深层嵌套对象序列化后值不变', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      await callTool(api, 'mteam_complete_task', {
        taskId,
        contextStep: 'deep',
        contextOutput: {
          data: { nested: { deep: { value: 42 } } },
          items: ['a', 'b'],
          map: { k1: 'v1' }
        }
      });

      const task = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { context: { output?: { data?: { nested?: { deep?: { value?: number } } } } }[] };
      assert.equal(task.context[1].output!.data!.nested!.deep!.value, 42);
      assert.equal(task.context[1].output!.items![0], 'a');
      assert.equal(task.context[1].output!.map!.k1, 'v1');
    });
  });

  describe('TC-K2：updateTaskRow 字段名映射正确（camelCase → snake_case）', () => {
    it('completedAt → completed_at，lastHeartbeatAt → last_heartbeat_at，lastExecutor → last_executor', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'done', contextOutput: {} });

      const db = getDb();
      const row = db.prepare('SELECT completed_at, last_heartbeat_at, last_executor FROM tasks WHERE task_id = ?').get(taskId) as any;

      assert.notEqual(row.completed_at, null);
      assert.equal(row.last_executor, null);
    });
  });

  describe('TC-K3：openDb 重复调用返回同一实例（单例）', () => {
    it('两次 openDb 同一路径返回同一对象引用', () => {
      const dbPath = '/tmp/singleton_test.db';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db1 = openDb(dbPath);
      const db2 = openDb(dbPath);

      assert.equal(db1, db2, '应返回同一数据库实例');

      closeDb();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });
  });

  describe('TC-K4：closeDb 后 getDb 抛出错误', () => {
    it('关闭后调用 getDb 抛出包含 "not opened" 的错误', () => {
      const dbPath = '/tmp/close_test.db';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      openDb(dbPath);
      closeDb();

      let err: any;
      try {
        getDb();
      } catch (e) {
        err = e;
      }

      assert.notEqual(err, undefined);
      assert.ok(err.message.includes('not opened'));

      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });
  });
});
