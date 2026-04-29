/**
 * operations.js 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'assert';
import path from 'node:path';
import fs from 'node:fs';
import { setWorkspaceRoot } from '../src/pool/operations.js';
import { TaskStatus } from '../src/schema/task.js';

const TEST_WORKSPACE = '/tmp/m-team-test-ops';

let poolMod, opsMod, schemaMod;

function cleanEnv() {
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
  setWorkspaceRoot(TEST_WORKSPACE);
}

describe('operations.js', () => {
  beforeEach(async () => {
    cleanEnv();
    opsMod = await import('../src/pool/operations.js');
    poolMod = await import('../src/pool/index.js');
    schemaMod = await import('../src/schema/task.js');
  });
  afterEach(() => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  // ============================================================
  // publishTask
  // ============================================================

  it('publishTask 创建任务并持久化', () => {
    const taskId = opsMod.publishTask({ description: 'test task', goal: 'do test', priority: 'high' });

    assert(taskId.startsWith('task_'), 'taskId 格式正确');
    const task = poolMod.getTask(taskId);
    assert(task !== null, '任务已存库');
    assert(task.description === 'test task');
    assert(task.goal === 'do test');
    assert(task.priority === 'high');
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.executor === null);
    assert(task.context[0].type === 'input');
  });

  it('publishTask 写入 task.json 文件', () => {
    const taskId = opsMod.publishTask({ description: 'file test', goal: 'goal' });

    const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
    assert(fs.existsSync(taskFile), 'task.json 应存在');
    const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    assert(content.taskId === taskId);
  });

  it('publishTask 优先级默认为 normal', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    assert(poolMod.getTask(taskId).priority === 'normal');
  });

  // ============================================================
  // claimTask
  // ============================================================

  it('claimTask 成功认领 pending 任务', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    const result = opsMod.claimTask(taskId, 'agent_1');
    assert(result.success === true, '认领应成功');
    assert(result.task.status === schemaMod.TaskStatus.RUNNING);
    assert(result.task.executor === 'agent_1');

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.RUNNING);
  });

  it('claimTask 非 pending 状态失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    opsMod.claimTask(taskId, 'agent_1');
    const result = opsMod.claimTask(taskId, 'agent_2');
    assert(result.success === false);
    assert(result.reason === 'NOT_PENDING');
  });

  it('claimTask relay 后旧 executor 可以重新认领（task 已变 PENDING）', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    opsMod.claimTask(taskId, 'agent_1');
    opsMod.relayTask(taskId, 'agent_1', { step: 'step1', output: {} });

    // relay 后任务变 PENDING，executor 清空，任何人都可以认领（包括旧 executor）
    const result = opsMod.claimTask(taskId, 'agent_1');
    assert(result.success === true, 'relay 后旧 executor 可重新认领');
    assert(result.task.executor === 'agent_1');
  });

  it('claimTask 不存在任务返回 NOT_FOUND', () => {
    const result = opsMod.claimTask('not_exist', 'agent_x');
    assert(result.success === false);
    assert(result.reason === 'TASK_NOT_FOUND');
  });

  it('claimTask relay 时 lastExecutor 记录正确', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    opsMod.claimTask(taskId, 'agent_1');
    opsMod.relayTask(taskId, 'agent_1', { step: 's1', output: {} });

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.executor === null);
    assert(task.lastExecutor === 'agent_1');
  });

  // ============================================================
  // updateTask
  // ============================================================

  it('updateTask 追加 context 条目', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    const updated = opsMod.updateTask(taskId, null, { step: 'step1', output: { result: 123 } });
    assert(updated.context.length === 2);
    assert(updated.context[1].step === 'step1');
    assert(updated.context[1].output.result === 123);
  });

  it('updateTask relay(PENDING) 清空 executor 记录 lastExecutor', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    opsMod.updateTask(taskId, schemaMod.TaskStatus.PENDING, null, 'new desc');

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.executor === null);
    assert(task.lastExecutor === 'agent_1');
    assert(task.description === 'new desc');
  });

  it('updateTask COMPLETED 时写入 completedAt', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    opsMod.updateTask(taskId, schemaMod.TaskStatus.COMPLETED);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.COMPLETED);
    assert(task.completedAt !== null);
  });

  it('updateTask cancelled 任务可以追加 context', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');
    opsMod.cancelTask(taskId, 'user', 'too hard');

    const updated = opsMod.updateTask(taskId, null, { step: 's1', output: {} });
    assert(updated.context.length === 2);
    assert(updated.status === schemaMod.TaskStatus.CANCELLED, '状态不变仍是 cancelled');
  });

  it('updateTask cancelled 任务不能 relay', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');
    opsMod.cancelTask(taskId, 'user', 'reason');

    const result = opsMod.updateTask(taskId, schemaMod.TaskStatus.PENDING);
    assert(result.error === 'TASK_CANCELLED', 'cancelled 任务拒绝 relay');
  });

  // ============================================================
  // cancelTask
  // ============================================================

  it('cancelTask 成功取消 running 任务', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.cancelTask(taskId, 'user', 'reason');
    assert(result.success === true);
    assert(poolMod.getTask(taskId).status === schemaMod.TaskStatus.CANCELLED);
  });

  it('cancelTask 非 publisher 失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g', publisher: 'user' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.cancelTask(taskId, 'other_user', 'reason');
    assert(result.success === false);
    assert(result.reason === 'NOT_PUBLISHER');
  });

  it('cancelTask 终态任务不可取消', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    opsMod.cancelTask(taskId, 'user', 'reason');
    const result = opsMod.cancelTask(taskId, 'user', 'reason2');
    assert(result.success === false);
    assert(result.reason === 'ALREADY_TERMINAL');
  });

  // ============================================================
  // relinquishTask
  // ============================================================

  it('relinquishTask 成功放回 pending', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.relinquishTask(taskId, 'agent_1');
    assert(result.success === true);
    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.executor === null);
    assert(task.lastExecutor === 'agent_1');
  });

  it('relinquishTask 非当前 executor 失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.relinquishTask(taskId, 'agent_2');
    assert(result.success === false);
    assert(result.reason === 'NOT_CURRENT_EXECUTOR');
  });

  it('relinquishTask cancelled 任务失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');
    opsMod.cancelTask(taskId, 'user', 'reason');

    const result = opsMod.relinquishTask(taskId, 'agent_1');
    assert(result.success === false);
    assert(result.reason === 'TASK_CANCELLED');
  });

  // ============================================================
  // relayTask
  // ============================================================

  it('relayTask 成功交接并追加 context', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.relayTask(taskId, 'agent_1', { step: 'step1', output: { summary: 'done half' } });
    assert(result.success === true);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.lastExecutor === 'agent_1');
    assert(task.context.length === 2);
    assert(task.context[1].step === 'step1');
    assert(task.context[1].output.summary === 'done half');
  });

  it('relayTask 非当前 executor 失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.relayTask(taskId, 'agent_2', { step: 's', output: {} });
    assert(result.success === false);
    assert(result.reason === 'NOT_CURRENT_EXECUTOR');
  });

  it('relayTask cancelled 任务失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');
    opsMod.cancelTask(taskId, 'user', 'reason');

    const result = opsMod.relayTask(taskId, 'agent_1', { step: 's', output: {} });
    assert(result.success === false);
    assert(result.reason === 'TASK_CANCELLED');
  });

  // ============================================================
  // completeTask / failTask
  // ============================================================

  it('completeTask 正常完成任务', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.completeTask(taskId, { step: 'final', output: { summary: 'ok' } });
    assert(result.success === true);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.COMPLETED);
    assert(task.completedAt !== null);
    assert(task.context.length === 2);
  });

  it('completeTask 非 running 状态失败（relay 后旧 session 结束）', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');
    opsMod.relayTask(taskId, 'agent_1', { step: 's', output: {} });

    const result = opsMod.completeTask(taskId);
    assert(result.success === false);
    assert(result.reason.startsWith('TASK_NOT_RUNNING'));
  });

  it('failTask 标记任务失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.failTask(taskId, 'something went wrong');
    assert(result.success === true);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.FAILED);
    assert(task.completedAt !== null);
  });

  it('failTask 非 running 状态失败', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });

    const result = opsMod.failTask(taskId);
    assert(result.success === false);
    assert(result.reason.startsWith('TASK_NOT_RUNNING'));
  });

  // ============================================================
  // TC-A4: Hook 兜底完成
  // ============================================================

  it('completeTask 仅传 fallbackEntry（hook 兜底）', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    // hook 调用时不传 contextEntry，只传 fallbackEntry
    const result = opsMod.completeTask(taskId, null, { outcome: 'ok', error: null });
    assert(result.success === true);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.COMPLETED);
    assert(task.context.length === 2);
    assert(task.context[1].step === 'ok');
    assert(JSON.stringify(task.context[1].output) === '{}');
  });

  it('failTask 仅传 fallbackEntry（hook 兜底）', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    const result = opsMod.failTask(taskId, 'connection lost', null, { outcome: 'error', error: 'connection lost' });
    assert(result.success === true);

    const task = poolMod.getTask(taskId);
    assert(task.status === schemaMod.TaskStatus.FAILED);
    assert(task.context.length === 2);
    assert(task.context[1].step === 'error');
    assert(task.context[1].output.error === 'connection lost');
  });

  it('completeTask executor 优先于 hook 兜底', () => {
    const taskId = opsMod.publishTask({ description: 'd', goal: 'g' });
    opsMod.claimTask(taskId, 'agent_1');

    // executor 先完成
    const result1 = opsMod.completeTask(taskId, { step: 'done', output: { summary: 'ok' } });
    assert(result1.success === true);

    // hook 兜底时任务已非 running，不会追加
    const result2 = opsMod.completeTask(taskId, null, { outcome: 'ok', error: null });
    assert(result2.success === false);
    assert(result2.reason.startsWith('TASK_NOT_RUNNING'));

    const task = poolMod.getTask(taskId);
    assert(task.context.length === 2);
    assert(task.context[1].step === 'done'); // executor 的 step，不是 'ok'
  });
});
