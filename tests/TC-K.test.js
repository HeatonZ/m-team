/**
 * TC-K：db.js 底层
 * 对应 docs/test-cases/TC-K.md
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, closeDb, getDb } from '../src/pool/db.js';
import { TaskStatus } from '../src/schema/task.js';
import * as ops from '../src/pool/operations.js';
import * as pool from '../src/pool/index.js';

describe('TC-K：db.js 底层', () => {

  // TC-K1: context 嵌套对象序列化正确
  describe('TC-K1：context 嵌套对象序列化正确', () => {
    it('深层嵌套对象序列化后值不变', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      ops.completeTask(taskId, {
        step: 'deep',
        output: {
          data: { nested: { deep: { value: 42 } } },
          items: ['a', 'b'],
          map: { k1: 'v1' }
        }
      });

      const task = pool.getTask(taskId);
      assert(task.context[1].output.data.nested.deep.value === 42);
      assert(task.context[1].output.items[0] === 'a');
      assert(task.context[1].output.map.k1 === 'v1');
    });
  });

  // TC-K2: updateTaskRow 字段名映射正确
  describe('TC-K2：updateTaskRow 字段名映射正确（camelCase → snake_case）', () => {
    it('completedAt → completed_at，lastHeartbeatAt → last_heartbeat_at，lastExecutor → last_executor', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      // completeTask 会写入 completedAt
      ops.completeTask(taskId, { step: 'done', output: {} });

      const db = getDb();
      const row = db.prepare('SELECT completed_at, last_heartbeat_at, last_executor FROM tasks WHERE task_id = ?').get(taskId);

      assert(row.completed_at !== null);
      // last_heartbeat_at 在 running 时会有值
      // last_executor 在 relay 时记录，此处直接 complete 没有 relay，所以是 null
      assert(row.last_executor === null);
    });
  });

  // TC-K3: openDb 重复调用返回同一实例
  describe('TC-K3：openDb 重复调用返回同一实例（单例）', () => {
    it('两次 openDb 同一路径返回同一对象引用', () => {
      const dbPath = '/tmp/singleton_test.db';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      const db1 = openDb(dbPath);
      const db2 = openDb(dbPath);

      assert(db1 === db2, '应返回同一数据库实例');

      closeDb();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });
  });

  // TC-K4: closeDb 后 getDb 抛出
  describe('TC-K4：closeDb 后 getDb 抛出错误', () => {
    it('关闭后调用 getDb 抛出包含 "not opened" 的错误', () => {
      const dbPath = '/tmp/close_test.db';
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

      openDb(dbPath);
      closeDb();

      let err;
      try {
        getDb();
      } catch (e) {
        err = e;
      }

      assert(err !== undefined);
      assert(err.message.includes('not opened'));

      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    });
  });
});
