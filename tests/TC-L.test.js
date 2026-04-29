/**
 * TC-L：读 API
 * 对应 docs/test-cases/TC-L.md
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-L：读 API', () => {
  // TC-L1: Agent 有活跃任务时不再返回待认领任务
  describe('TC-L1：Agent 有活跃任务时不再返回待认领任务', () => {
    it('alice 有活跃任务时 getPendingTasks(alice) 返回空', () => {
      ops.publishTask({ description: 't1', goal: 'g' });
      ops.publishTask({ description: 't2', goal: 'g' });

      const t1Id = ops.publishTask({ description: 't1', goal: 'g' });
      ops.claimTask(t1Id, 'alice');

      assert(pool.getPendingTasks('alice').length === 0);
    });

    it('bob 无活跃任务，可正常获取待认领任务', () => {
      const t1Id = ops.publishTask({ description: 't1', goal: 'g' });
      const t2Id = ops.publishTask({ description: 't2', goal: 'g' });
      ops.claimTask(t1Id, 'alice');

      const pending = pool.getPendingTasks('bob');
      assert(pending.length >= 1);
    });
  });

  // TC-L2: getAgentActiveTask 返回当前 Runner
  describe('TC-L2：getAgentActiveTask 返回当前 Runner', () => {
    it('alice 认领后 getAgentActiveTask(alice) 返回该任务', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const active = pool.getAgentActiveTask('alice');
      assert(active !== null);
      assert(active.taskId === taskId);
      assert(active.status === TaskStatus.RUNNING);
      assert(active.executor === 'alice');
    });

    it('bob 无活跃任务时返回 null', () => {
      ops.publishTask({ description: 'd', goal: 'g' });

      const active = pool.getAgentActiveTask('bob');
      assert(active === null);
    });
  });

  // TC-L3: getTasksByExecutor 按执行人筛选
  describe('TC-L3：getTasksByExecutor 按执行人筛选', () => {
    it('alice 名下只有已完成任务，bob 名下只有进行中任务', () => {
      const t1 = ops.publishTask({ description: 't1', goal: 'g' });
      const t2 = ops.publishTask({ description: 't2', goal: 'g' });
      const t3 = ops.publishTask({ description: 't3', goal: 'g' });

      ops.claimTask(t1, 'alice');
      ops.completeTask(t1, { step: 'done', output: {} });

      ops.claimTask(t2, 'bob');

      // t3 保持 PENDING

      const aliceTasks = pool.getTasksByExecutor('alice');
      const bobTasks = pool.getTasksByExecutor('bob');

      assert(aliceTasks.length === 1);
      assert(aliceTasks[0].taskId === t1);
      assert(bobTasks.length === 1);
      assert(bobTasks[0].taskId === t2);
    });

    it('getTasksByExecutor 不返回执行人为空的任务', () => {
      const t3 = ops.publishTask({ description: 't3', goal: 'g' }); // PENDING，执行人为空

      const aliceTasks = pool.getTasksByExecutor('alice');
      const taskIds = aliceTasks.map(t => t.taskId);
      assert(!taskIds.includes(t3));
    });
  });
});
