/**
 * TC-D：取消任务流程
 * 对应 docs/test-cases/TC-D.md
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-D：取消任务流程', () => {

  // TC-D1: Publisher 取消 Running 任务
  describe('TC-D1：Publisher 取消 Running 任务', () => {
    it('Publisher 取消 Running 任务成功，状态变为 CANCELLED', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.cancelTask(taskId, 'user', '优先级调整');

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.CANCELLED);
      assert(task.completedAt !== null);
      assert(task.executor === null);
    });

    it('取消后 bob 认领失败，任务不是待认领状态', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const result = ops.claimTask(taskId, 'bob');
      assert(result.success === false);
      assert(result.reason === 'NOT_PENDING');
    });
  });

  // TC-D2: 非 Publisher 无法取消
  describe('TC-D2：非 Publisher 无法取消', () => {
    it('非发布者取消失败', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g', publisher: 'boss' });
      ops.claimTask(taskId, 'alice');

      const result = ops.cancelTask(taskId, 'other_user', 'reason');

      assert(result.success === false);
      assert(result.reason === 'NOT_PUBLISHER');
      assert(pool.getTask(taskId).status === TaskStatus.RUNNING);
      assert(pool.getTask(taskId).executor === 'alice');
    });
  });

  // TC-D3: 取消尚未被认领的 PENDING 任务
  describe('TC-D3：取消尚未被认领的 PENDING 任务', () => {
    it('直接取消 PENDING 任务成功', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });

      const result = ops.cancelTask(taskId, 'user', 'reason');

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.CANCELLED);
      assert(task.executor === null);
    });
  });

  // TC-D4: 终态任务不可再取消
  describe('TC-D4：终态任务不可再取消', () => {
    it('已取消的任务再次取消失败', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason1');

      const result = ops.cancelTask(taskId, 'user', 'reason2');

      assert(result.success === false);
      assert(result.reason === 'ALREADY_TERMINAL');
      assert(pool.getTask(taskId).status === TaskStatus.CANCELLED);
    });
  });

  // TC-D5: Relay 后任务被取消
  describe('TC-D5：Relay 后任务被取消', () => {
    it('relay 后 Publisher 取消，alice 的上下文记录保留', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: 'alice_step', output: {} });

      const result = ops.cancelTask(taskId, 'user', 'reason');

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.CANCELLED);
      assert(task.context.length === 2);
      assert(task.context[1].step === 'alice_step');

      // bob 无法认领已取消任务
      const r2 = ops.claimTask(taskId, 'bob');
      assert(r2.success === false);
    });
  });
});
