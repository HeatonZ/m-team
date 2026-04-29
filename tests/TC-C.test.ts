/**
 * TC-C：任务失败流程
 * 对应 docs/test-cases/TC-C.md
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-C：任务失败流程', () => {

  describe('TC-C1：Agent 执行失败并标记失败', () => {
    it('alice 失败，任务状态变为 failed', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.failTask(taskId, '网络不可达', null, {
        outcome: '网络不可达',
        output: { error: '网络不可达' }
      });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.FAILED);
      assert.notEqual(task!.completedAt, null);
      assert.equal(task!.executor, null);
      assert.equal(task!.context.length, 2);
    });

    it('查询确认状态为失败、完成时间不为空', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.failTask(taskId, '网络不可达', null, { outcome: 'error', output: { error: '网络不可达' } });

      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.FAILED);
      assert.notEqual(task!.completedAt, null);
    });
  });

  describe('TC-C2：失败后再次调用失败', () => {
    it('再次调用 failTask 失败，任务状态保持 failed', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.failTask(taskId, 'error1', null, { outcome: 'error', output: {} });

      const result = ops.failTask(taskId, 'error2', null, { outcome: 'error', output: {} });

      assert.equal(result.success, false);
      assert.ok(result.reason !== undefined && result.reason.startsWith('TASK_NOT_RUNNING'));
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.FAILED);
    });
  });

  describe('TC-C3：认领后未开始直接失败', () => {
    it('不传 contextEntry 直接 failTask，context 长度仍为 1', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.failTask(taskId, '无法执行');

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.FAILED);
      assert.equal(task!.context.length, 1); // 无中间步骤
    });
  });
});
