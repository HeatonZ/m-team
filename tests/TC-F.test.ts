/**
 * TC-F：Cancelled 任务的宽容处理
 * 对应 docs/test-cases/TC-F.md
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-F：Cancelled 任务的宽容处理', () => {

  describe('TC-F1：Cancelled 任务允许追加上下文', () => {
    it('cancel 后 updateTask 追加 context 成功，状态保持 CANCELLED', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const updated = ops.updateTask(taskId, null, { step: '事后通知用户', output: {} });

      assert.equal(updated.status, TaskStatus.CANCELLED);
      assert.equal(updated.context.length, 2);
    });
  });

  describe('TC-F2：Cancelled 任务拒绝 Relay', () => {
    it('cancel 后 relayTask 失败，返回 TASK_CANCELLED', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const result = ops.relayTask(taskId, 'alice', { step: 's', output: {} });

      assert.equal(result.success, false);
      assert.equal(result.reason, 'TASK_CANCELLED');
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.CANCELLED);
    });
  });

  describe('TC-F3：Cancelled 任务拒绝 Complete', () => {
    it('cancel 后 completeTask 失败，任务保持 CANCELLED', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const result = ops.completeTask(taskId, { step: 'done', output: {} });

      assert.equal(result.success, false);
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.CANCELLED);
    });
  });
});
