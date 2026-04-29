/**
 * TC-G：并发场景
 * 对应 docs/test-cases/TC-G.md
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-G：并发场景', () => {

  describe('TC-G1：两个 Agent 同时认领同一任务', () => {
    it('并发 claimTask 只有一个成功，另一个失败', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });

      const result1 = ops.claimTask(taskId, 'alice');
      const result2 = ops.claimTask(taskId, 'bob');

      const successes = [result1, result2].filter(r => r.success);
      const failures = [result1, result2].filter(r => !r.success);

      assert.equal(successes.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(failures[0]!.reason, 'NOT_PENDING');

      const task = pool.getTask(taskId);
      const winner = result1.success ? 'alice' : 'bob';
      assert.equal(task!.executor, winner);
    });
  });

  describe('TC-G2：Agent 已有活跃任务不再分配新任务', () => {
    it('alice 有活跃任务时 getPendingTasks(alice) 返回空', () => {
      const taskId1 = ops.publishTask({ description: 't1', goal: 'g' });
      ops.claimTask(taskId1, 'alice');

      const pending = pool.getPendingTasks('alice');
      assert.equal(pending.length, 0);
    });

    it('alice 有活跃任务时 bob 仍能正常获取待认领任务', () => {
      const taskId1 = ops.publishTask({ description: 't1', goal: 'g' });
      const taskId2 = ops.publishTask({ description: 't2', goal: 'g' });
      ops.claimTask(taskId1, 'alice');

      const pending = pool.getPendingTasks('bob');
      assert.ok(pending.length >= 1);
    });

    it('alice 有活跃任务时再次认领新任务失败', () => {
      const taskId1 = ops.publishTask({ description: 't1', goal: 'g' });
      const taskId2 = ops.publishTask({ description: 't2', goal: 'g' });
      ops.claimTask(taskId1, 'alice');

      const result = ops.claimTask(taskId2, 'alice');
      assert.equal(result.success, false);
    });
  });
});
