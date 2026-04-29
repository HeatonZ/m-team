/**
 * TC-J：优先级调度
 * 对应 docs/test-cases/TC-J.md
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-J：优先级调度', () => {

  describe('TC-J1：高优先级任务优先返回', () => {
    it('getPendingTasks 返回顺序：high > normal > low', () => {
      ops.publishTask({ description: 'normal任务', goal: 'g', priority: 'normal' });
      ops.publishTask({ description: 'high任务', goal: 'g', priority: 'high' });
      ops.publishTask({ description: 'low任务', goal: 'g', priority: 'low' });

      const pending = pool.getPendingTasks();

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
    it('同优先级按 createdAt 升序返回', () => {
      const taskId1 = ops.publishTask({ description: '先发', goal: 'g', priority: 'normal' });
      const taskId2 = ops.publishTask({ description: '后发', goal: 'g', priority: 'normal' });

      const pending = pool.getPendingTasks();
      const ids = pending.map(t => t.taskId);

      assert.ok(ids.indexOf(taskId1) < ids.indexOf(taskId2), '先发的任务应在前');
    });
  });
});
