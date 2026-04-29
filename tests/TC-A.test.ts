/**
 * TC-A：正常完成流程
 * 对应 docs/test-cases/TC-A.md
 */
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-A：正常完成流程', () => {

  describe('TC-A1：Agent 完整执行并完成任务', () => {
    it('publishTask 创建任务，状态为待认领，上下文长度为1', () => {
      const taskId = ops.publishTask({
        description: '分析销售数据',
        goal: '生成月报',
        publisher: 'boss',
        priority: 'high'
      });

      const task = pool.getTask(taskId);
      assert(task !== null);
      assert.equal(task!.status, TaskStatus.PENDING);
      assert.equal(task!.executor, null);
      assert.equal(task!.lastExecutor, null);
      assert.equal(task!.context.length, 1);
      assert.equal(task!.context[0].type, 'input');
      assert.equal(task!.priority, 'high');
      assert.equal(task!.publisher, 'boss');
      assert.equal(task!.completedAt, null);
    });

    it('alice 认领任务，状态变为执行中，执行人变为 alice', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      const result = ops.claimTask(taskId, 'alice');

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.RUNNING);
      assert.equal(task!.executor, 'alice');
    });

    it('alice relay 数据清洗，任务状态变为待认领，context 长度为2', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.relayTask(taskId, 'alice', {
        step: '数据清洗',
        output: { summary: '清洗5000行', files: ['清洗结果.json'] }
      });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.PENDING);
      assert.equal(task!.executor, null);
      assert.equal(task!.lastExecutor, 'alice');
      assert.equal(task!.context.length, 2);
      assert.equal(task!.context[1].step, '数据清洗');
      assert.equal(task!.context[1].output?.summary, '清洗5000行');
      assert.equal(task!.context[1].executor, 'alice');
    });

    it('bob relay 生成图表，context 长度为3', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: '数据清洗', output: {} });

      ops.claimTask(taskId, 'bob');
      const result = ops.relayTask(taskId, 'bob', {
        step: '生成图表',
        output: { summary: '生成3张图表', files: ['图表1.png', '图表2.png', '图表3.png'] }
      });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.PENDING);
      assert.equal(task!.executor, null);
      assert.equal(task!.lastExecutor, 'bob');
      assert.equal(task!.context.length, 3);
      assert.equal(task!.context[1].step, '数据清洗');
      assert.equal(task!.context[2].step, '生成图表');
    });

    it('alice 再次认领并 complete，任务完成，context 长度为4', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: '数据清洗', output: {} });
      ops.claimTask(taskId, 'bob');
      ops.relayTask(taskId, 'bob', { step: '生成图表', output: {} });

      ops.claimTask(taskId, 'alice');
      const result = ops.completeTask(taskId, { step: '最终提交', output: { summary: '月报已完成' } });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.COMPLETED);
      assert.notEqual(task!.completedAt, null);
      assert.equal(task!.executor, null);
      assert.equal(task!.context.length, 4);
      assert.equal(task!.context[3].step, '最终提交');
    });

    it('任务完成后，alice 的活跃任务返回空', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: '数据清洗', output: {} });
      ops.claimTask(taskId, 'bob');
      ops.relayTask(taskId, 'bob', { step: '生成图表', output: {} });
      ops.claimTask(taskId, 'alice');
      ops.completeTask(taskId, { step: '最终提交', output: {} });

      const activeTask = pool.getAgentActiveTask('alice');
      assert.equal(activeTask, null);
    });

    it('任务完成后，alice 的待认领任务返回空', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.completeTask(taskId, { step: 'done', output: {} });

      const pending = pool.getPendingTasks('alice');
      assert.equal(pending.length, 0);
    });
  });

  describe('TC-A2：心跳保活', () => {
    it('心跳只更新时间戳，不追加 context，不改变状态', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const updated = ops.updateTask(taskId, null, null, null, Date.now());

      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.RUNNING);
      assert.equal(task!.context.length, 1);
      assert.notEqual(updated.lastHeartbeatAt, null);
    });
  });

  describe('TC-A3：快速完成（一步完成）', () => {
    it('alice 认领后直接 complete，context 长度为2', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.completeTask(taskId, { step: '任务完成', output: { summary: '完成' } });

      assert.equal(result.success, true);
      const task = pool.getTask(taskId);
      assert.equal(task!.status, TaskStatus.COMPLETED);
      assert.notEqual(task!.completedAt, null);
      assert.equal(task!.context.length, 2);
      assert.equal(task!.context[1].step, '任务完成');
      assert.equal(task!.context[1].output?.summary, '完成');
    });
  });

  describe('TC-A4：relay_task 交接流转', () => {
    it('relay 后下一个 agent 可继续执行', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');

      const result = ops.relayTask(taskId, 'alice', {
        step: '第一步',
        output: { files: ['step1_out.json'] }
      });
      assert.equal(result.success, true);
      assert.equal(pool.getTask(taskId)!.status, TaskStatus.PENDING);

      const result2 = ops.claimTask(taskId, 'bob');
      assert.equal(result2.success, true);
      assert.equal(pool.getTask(taskId)!.executor, 'bob');
    });
  });
});
