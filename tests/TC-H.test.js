/**
 * TC-H：守卫顺序验证
 * 对应 docs/test-cases/TC-H.md
 * 验证 relayTask/relinquishTask 中 CANCELLED 检查在 executor 检查之前
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-H：守卫顺序验证', () => {

  // TC-H1: relayTask 守卫顺序
  describe('TC-H1：cancelTask 后 executor 清空，relayTask 应返回 TASK_CANCELLED', () => {
    it('cancelTask 清空 executor 后，relayTask 应返回 TASK_CANCELLED（不是 NOT_CURRENT_EXECUTOR）', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      // alice 已被清空，relayTask 若先检查 executor 会返回 NOT_CURRENT_EXECUTOR
      // 若先检查 CANCELLED 则应返回 TASK_CANCELLED（正确）
      const result = ops.relayTask(taskId, 'alice', { step: 's', output: {} });

      assert(result.success === false);
      assert(result.reason === 'TASK_CANCELLED');
    });
  });

  // TC-H2: relinquishTask 守卫顺序
  describe('TC-H2：relinquishTask 守卫顺序同样验证', () => {
    it('cancelTask 清空 executor 后，relinquishTask 应返回 TASK_CANCELLED', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.cancelTask(taskId, 'user', 'reason');

      const result = ops.relinquishTask(taskId, 'alice');

      assert(result.success === false);
      assert(result.reason === 'TASK_CANCELLED');
    });
  });
});
