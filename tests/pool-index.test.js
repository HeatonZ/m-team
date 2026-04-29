/**
 * pool/index.js 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'assert';
import path from 'node:path';
import fs from 'node:fs';
import { setWorkspaceRoot } from '../src/pool/operations.js';
import { TaskStatus } from '../src/schema/task.js';
import { getDb } from '../src/pool/db.js';

const TEST_WORKSPACE = '/tmp/m-team-test-pool';

let poolMod, opsMod;

function cleanEnv() {
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
  setWorkspaceRoot(TEST_WORKSPACE);
}

/** 直接写 DB 的 created_at（用于控制排序） */
function setCreatedAt(taskId, ts) {
  getDb().prepare('UPDATE tasks SET created_at = ? WHERE task_id = ?').run(ts, taskId);
}

describe('pool/index.js', () => {
  beforeEach(async () => {
    cleanEnv();
    opsMod = await import('../src/pool/operations.js');
    poolMod = await import('../src/pool/index.js');
  });
  afterEach(() => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  // ============================================================
  // getPendingTasks
  // ============================================================

  it('getPendingTasks 返回最多3条', () => {
    // 发布5个，正常优先级
    opsMod.publishTask({ description: 't1', goal: 'g' });
    opsMod.publishTask({ description: 't2', goal: 'g' });
    opsMod.publishTask({ description: 't3', goal: 'g' });
    opsMod.publishTask({ description: 't4', goal: 'g' });
    opsMod.publishTask({ description: 't5', goal: 'g' });

    const pending = poolMod.getPendingTasks();
    assert(pending.length === 3, '最多3条');
  });

  it('getPendingTasks 按 priority ASC 排序（字母序：high < low < normal）', async () => {
    opsMod.publishTask({ description: 'low', goal: 'g', priority: 'low' });
    opsMod.publishTask({ description: 'high', goal: 'g', priority: 'high' });
    opsMod.publishTask({ description: 'normal', goal: 'g', priority: 'normal' });

    const pending = poolMod.getPendingTasks();
    // ORDER BY priority ASC = 字母序：high < low < normal
    assert(pending[0].description === 'high', `expected high, got ${pending[0].description}`);
    assert(pending[1].description === 'low', `expected low, got ${pending[1].description}`);
    assert(pending[2].description === 'normal', `expected normal, got ${pending[2].description}`);
  });

  it('getPendingTasks 同优先级按 created_at ASC', () => {
    // 控制 created_at：后发布但时间戳更早
    const t1 = opsMod.publishTask({ description: 'first', goal: 'g' });
    setCreatedAt(t1, 1000);
    const t2 = opsMod.publishTask({ description: 'second', goal: 'g' });
    setCreatedAt(t2, 2000);

    const pending = poolMod.getPendingTasks();
    assert(pending[0].description === 'first', '更早的在前');
    assert(pending[1].description === 'second');
  });

  it('getPendingTasks agent 有 active 任务时返回空', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const pending = poolMod.getPendingTasks('agent_1');
    assert(pending.length === 0, '有 active 任务返回空');
  });

  it('getPendingTasks 已有 active 任务的 agent 不影响其他 agent', () => {
    opsMod.publishTask({ description: 'd1', goal: 'g' });
    const taskId2 = opsMod.publishTask({ description: 'd2', goal: 'g' });

    opsMod.claimTask(taskId2, 'agent_2');

    const pending = poolMod.getPendingTasks('agent_1');
    assert(pending.length === 1);
  });

  // ============================================================
  // getAgentActiveTask
  // ============================================================

  it('getAgentActiveTask 返回正在执行的任务', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const active = poolMod.getAgentActiveTask('agent_1');
    assert(active !== null);
    assert(active.taskId === taskId);
    assert(active.status === TaskStatus.RUNNING);
  });

  it('getAgentActiveTask 无任务返回 null', () => {
    assert(poolMod.getAgentActiveTask('nobody') === null);
  });

  // ============================================================
  // getTask / getAllTasks
  // ============================================================

  it('getTask 返回指定任务', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    const task = poolMod.getTask(taskId);
    assert(task !== null);
    assert(task.taskId === taskId);
  });

  it('getTask 不存在返回 null', () => {
    assert(poolMod.getTask('not_exist') === null);
  });

  it('getAllTasks 返回所有任务', () => {
    opsMod.publishTask({ description: 'd1', goal: 'g' });
    opsMod.publishTask({ description: 'd2', goal: 'g' });
    const all = poolMod.getAllTasks();
    assert(all.length >= 2);
  });

  // ============================================================
  // getTasksByExecutor
  // ============================================================

  it('getTasksByExecutor 按 executor 筛选', () => {
    const t1 = opsMod.publishTask({ description: 'd1', goal: 'g' });
    const t2 = opsMod.publishTask({ description: 'd2', goal: 'g' });

    opsMod.claimTask(t1, 'agent_x');
    opsMod.claimTask(t2, 'agent_y');

    const tasks = poolMod.getTasksByExecutor('agent_x');
    assert(tasks.length === 1);
    assert(tasks[0].taskId === t1);
  });
});
