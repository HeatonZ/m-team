/**
 * db.js 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'assert';
import { openDb, closeDb, getDb } from '../src/pool/db.js';
import path from 'node:path';
import fs from 'node:fs';

const TEST_DB = '/tmp/m-team-test-db.db';

function cleanDb() {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  openDb(TEST_DB);
}

// 模块引用（每个测试动态 import）
let /** @type {import('../src/pool/db.js')} */ dbMod;

describe('db.js', () => {
  beforeEach(async () => {
    cleanDb();
    dbMod = await import('../src/pool/db.js');
  });
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  // ============================================================
  // schema init
  // ============================================================

  it('openDb 创建表结构和索引', () => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    const names = tables.map(r => r.name);
    assert(names.includes('tasks'), '应有 tasks 表');

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index'"
    ).all();
    const idxNames = indexes.map(r => r.name);
    assert(idxNames.includes('idx_tasks_status'), '应有 idx_tasks_status 索引');
    assert(idxNames.includes('idx_tasks_priority'), '应有 idx_tasks_priority 索引');
  });

  it('openDb 重复调用返回同一实例', () => {
    const db1 = openDb(TEST_DB);
    const db2 = openDb(TEST_DB);
    assert(db1 === db2, '应返回同一实例');
  });

  it('getDb 未 openDb 时抛出', () => {
    closeDb();
    assert.throws(() => getDb(), /not opened/);
  });

  // ============================================================
  // insertTask / getTaskRow
  // ============================================================

  it('insertTask 写入后 getTaskRow 可取出', () => {
    const task = makeTask({ taskId: 'task_1', description: 'test', goal: 'do it' });
    dbMod.insertTask(task);

    const row = dbMod.getTaskRow('task_1');
    assert(row !== null, '应有记录');
    assert(row.taskId === 'task_1');
    assert(row.description === 'test');
    assert(row.goal === 'do it');
    assert(row.status === 'pending');
    assert(Array.isArray(row.context));
  });

  it('getTaskRow 不存在的 taskId 返回 null', () => {
    assert(dbMod.getTaskRow('not_exist') === null);
  });

  it('context 序列化和反序列化正确', () => {
    const task = makeTask({
      taskId: 'task_ctx',
      description: 'ctx test',
      goal: 'goal',
      context: [
        { type: 'input', data: { foo: 123 }, createdAt: 1000 },
        { executor: 'agent_1', step: 'step1', output: { bar: 456 }, completedAt: 2000 }
      ]
    });
    dbMod.insertTask(task);

    const row = dbMod.getTaskRow('task_ctx');
    assert(row.context.length === 2);
    assert(row.context[0].type === 'input');
    assert(row.context[0].data.foo === 123);
    assert(row.context[1].executor === 'agent_1');
    assert(row.context[1].output.bar === 456);
  });

  // ============================================================
  // updateTaskRow
  // ============================================================

  it('updateTaskRow 单个字段更新正确', () => {
    dbMod.insertTask(makeTask({ taskId: 'task_up', description: 'old', goal: 'goal' }));
    dbMod.updateTaskRow('task_up', { description: 'new' });

    const row = dbMod.getTaskRow('task_up');
    assert(row.description === 'new', 'description 应更新');
    assert(row.goal === 'goal', '未修改字段保持不变');
  });

  it('updateTaskRow 字段名映射正确', () => {
    dbMod.insertTask(makeTask({ taskId: 'task_map', description: 'd', goal: 'g' }));
    dbMod.updateTaskRow('task_map', {
      status: 'running',
      executor: 'agent_x',
      completedAt: 1234567890,
      lastHeartbeatAt: 9876543,
      lastExecutor: 'agent_y'
    });

    const row = dbMod.getTaskRow('task_map');
    assert(row.status === 'running');
    assert(row.executor === 'agent_x');
    assert(row.completedAt === 1234567890);
    assert(row.lastHeartbeatAt === 9876543);
    assert(row.lastExecutor === 'agent_y');
  });

  it('updateTaskRow 不存在的 taskId 无副作用', () => {
    assert.doesNotThrow(() => dbMod.updateTaskRow('not_exist', { status: 'running' }));
  });

  // ============================================================
  // deleteTaskRow
  // ============================================================

  it('deleteTaskRow 删除成功', () => {
    dbMod.insertTask(makeTask({ taskId: 'task_del', description: 'd', goal: 'g' }));
    dbMod.deleteTaskRow('task_del');
    assert(dbMod.getTaskRow('task_del') === null);
  });

  // ============================================================
  // 查询类
  // ============================================================

  it('getAllTaskRows 按 created_at DESC 排序', () => {
    dbMod.insertTask(makeTask({ taskId: 'task_a', description: 'a', goal: 'g' }));
    dbMod.insertTask(makeTask({ taskId: 'task_b', description: 'b', goal: 'g' }));
    dbMod.insertTask(makeTask({ taskId: 'task_c', description: 'c', goal: 'g' }));

    const rows = dbMod.getAllTaskRows();
    assert(rows[0].taskId === 'task_c', '最新应该在最前');
    assert(rows[2].taskId === 'task_a');
  });

  it('getTaskRowsByStatus 筛选正确 + 排序正确', () => {
    dbMod.insertTask(Object.assign(makeTask({ taskId: 't1', description: 'd', goal: 'g' }), { status: 'pending', priority: 'normal' }));
    dbMod.insertTask(Object.assign(makeTask({ taskId: 't2', description: 'd', goal: 'g' }), { status: 'pending', priority: 'high' }));
    dbMod.insertTask(Object.assign(makeTask({ taskId: 't3', description: 'd', goal: 'g' }), { status: 'running', priority: 'high' }));

    const pending = dbMod.getTaskRowsByStatus('pending');
    assert(pending.length === 2, '应有2条pending');
    assert(pending[0].taskId === 't2', 'high 优先于 normal');
    assert(pending[1].taskId === 't1');
  });

  it('getTaskRowByExecutor 正确', () => {
    dbMod.insertTask(Object.assign(makeTask({ taskId: 't1', description: 'd', goal: 'g' }), { executor: 'agent_a', status: 'running' }));
    dbMod.insertTask(Object.assign(makeTask({ taskId: 't2', description: 'd', goal: 'g' }), { executor: 'agent_b', status: 'pending' }));

    const row = dbMod.getTaskRowByExecutor('agent_a');
    assert(row !== null);
    assert(row.taskId === 't1');

    assert(dbMod.getTaskRowByExecutor('agent_b') === null, 'pending 状态不匹配');
    assert(dbMod.getTaskRowByExecutor('not_exist') === null);
  });

  // ============================================================
  // 辅助
  // ============================================================

  function makeTask({ taskId, description = 'd', goal = 'g', context = [], priority = 'normal', status = 'pending' }) {
    return {
      taskId,
      description,
      goal,
      context: context.length > 0 ? context : [{ type: 'input', data: {}, createdAt: Date.now() }],
      priority,
      publisher: 'test',
      status,
      executor: null,
      lastExecutor: null,
      createdAt: Date.now(),
      completedAt: null,
      lastHeartbeatAt: null
    };
  }
});
