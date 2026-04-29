/**
 * TC-B：中转交接流程
 * 对应 docs/test-cases/TC-B.md
 */
import { describe, it, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-B：中转交接流程', () => {

  // TC-B1: 单次 Relay
  describe('TC-B1：单次 Relay', () => {
    it('alice relay 后任务变为待认领，lastExecutor 记录为 alice', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.relayTask(taskId, 'alice', { step: '第一步', output: { summary: 'done' } });

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.PENDING);
      assert(task.executor === null);
      assert(task.lastExecutor === 'alice');
      assert(task.context.length === 2);
    });

    it('bob 认领 relay 后的任务', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: '第一步', output: {} });

      const result = ops.claimTask(taskId, 'bob');
      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.executor === 'bob');
      assert(task.lastExecutor === 'alice');
    });

    it('bob 完成，context 长度 = alice(1) + bob_final(1) = 2', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: '第一步', output: {} });
      ops.claimTask(taskId, 'bob');

      const result = ops.completeTask(taskId, { step: '完成', output: {} });

      assert(result.success === true);
      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.COMPLETED);
      assert(task.context.length === 3);
      assert(task.context[1].step === '第一步');
      assert(task.context[2].step === '完成');
    });
  });

  // TC-B2: 多次 Relay
  describe('TC-B2：多次 Relay（alice → bob → carol）', () => {
    it('三轮 relay 后完成，context 长度 = 4', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });

      // alice
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: 'alice_step1', output: {} });

      // bob
      ops.claimTask(taskId, 'bob');
      ops.relayTask(taskId, 'bob', { step: 'bob_step1', output: {} });

      // carol
      ops.claimTask(taskId, 'carol');
      ops.completeTask(taskId, { step: 'carol_final', output: {} });

      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.COMPLETED);
      assert(task.context.length === 4);
      assert(task.context[1].step === 'alice_step1');
      assert(task.context[2].step === 'bob_step1');
      assert(task.context[3].step === 'carol_final');
      assert(task.context[1].executor === 'alice');
      assert(task.context[2].executor === 'bob');
      assert(task.context[3].executor === 'carol');
    });
  });

  // TC-B3: Relay 后旧 Session 结束
  describe('TC-B3：Relay 后旧 Session 结束', () => {
    it('relay 后旧 session 再调用 completeTask 失败，任务保持 pending', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: 'done', output: {} });

      // alice 的旧 session 窗口调用 completeTask
      const result = ops.completeTask(taskId, { step: 'old_session_complete', output: {} });

      assert(result.success === false);
      assert(result.reason.startsWith('TASK_NOT_RUNNING'));

      const task = pool.getTask(taskId);
      assert(task.status === TaskStatus.PENDING);
      assert(task.context.length === 2); // relay 的记录未被覆盖
      assert(task.context[1].step === 'done');
    });
  });
});
