/**
 * TC-E：放弃任务流程
 * 对应 docs/test-cases/TC-E.md
 * 区别于 relay：relinquish 不追加 context 步骤
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-E：放弃任务流程', () => {

  describe('TC-E1：Agent 放弃后另一个 Agent 完成', () => {
    it('relinquish 不追加 context（与 relay 的关键区别）', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      // 先用 updateTask 追加一条上下文（模拟部分工作）
      ops.updateTask(taskId, null, { step: '做了部分工作', output: {} });
      assert.equal(pool.getTask(taskId)!.context.length, 2);

      const result = ops.relinquishTask(taskId, 'alice');
      assert.equal(result.success, true);

      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.PENDING);
      assert.equal(task!.executor, null);
      assert.equal(task!.lastExecutor, 'alice');
      assert.equal(task!.context.length, 2); // relinquish 不追加，context 不变
    });

    it('bob 接手完成，context 长度只增加 1（bob 的完成步骤）', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.updateTask(taskId, null, { step: '部分工作', output: {} });
      ops.relinquishTask(taskId, 'alice');

      ops.claimTask(taskId, 'bob');
      const result = ops.completeTask(taskId, { step: 'bob 完成', output: {} });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.COMPLETED);
      assert.equal(task!.context.length, 3); // input + alice部分 + bob完成
    });
  });

  describe('TC-E2：非当前 Executor 放弃失败', () => {
    it('bob 放弃 alice 的任务失败', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.relinquishTask(taskId, 'bob');

      assert.equal(result.success, false);
      assert.equal(result.reason, 'NOT_CURRENT_EXECUTOR');
      assert.equal(pool.getTask(taskId)!.executor, 'alice');
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.RUNNING);
    });
  });

  describe('TC-E3：CANCELLED 任务不可放弃', () => {
    it('已取消的任务 relinquishment 失败', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const result = ops.relinquishTask(taskId, 'alice');

      assert.equal(result.success, false);
      assert.equal(result.reason, 'TASK_CANCELLED');
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.CANCELLED);
    });
  });
});
