/**
 * TC-C：任务失败流程
 * 对应 docs/test-cases/TC-C.md
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-C：任务失败流程', () => {

  // TC-C1: Agent 执行失败并标记失败
  describe('TC-C1：Agent 执行失败并标记失败', () => {
    it('alice 失败，任务状态变为 failed', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.failTask(taskId, '网络不可达', null, {
        outcome: '网络不可达',
        output: { error: '网络不可达' }
      });

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.FAILED);
      assert(task.completedAt !== null);
      assert(task.executor === null);
      assert(task.context.length === 2);
    });

    it('查询确认状态为失败、完成时间不为空', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.failTask(taskId, '网络不可达', null, { outcome: 'error', output: { error: '网络不可达' } });

      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.FAILED);
      assert(task.completedAt !== null);
    });
  });

  // TC-C2: 失败后再次调用失败
  describe('TC-C2：失败后再次调用失败', () => {
    it('再次调用 failTask 失败，任务状态保持 failed', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.failTask(taskId, 'error1', null, { outcome: 'error', output: {} });

      const result = ops.failTask(taskId, 'error2', null, { outcome: 'error', output: {} });

      assert(result.success === false);
      assert(result.reason.startsWith('TASK_NOT_RUNNING'));
      assert(pool.getTask(taskId).status === TaskStatus.FAILED);
    });
  });

  // TC-C3: 认领后未开始直接失败
  describe('TC-C3：认领后未开始直接失败', () => {
    it('不传 contextEntry 直接 failTask，context 长度仍为 1', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.failTask(taskId, '无法执行');

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.FAILED);
      assert(task.context.length === 1); // 无中间步骤
    });
  });
});
