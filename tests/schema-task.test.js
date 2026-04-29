/**
 * schema/task.js 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { strict as assert } from 'assert';
import fs from 'node:fs';
import path from 'node:path';

const TEST_ROOT = '/tmp/m-team-test-schema';

let schemaMod;

function cleanRoot() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

describe('schema/task.js', () => {
  beforeEach(async () => {
    cleanRoot();
    schemaMod = await import('../src/schema/task.js');
    schemaMod.setWorkspaceRoot(TEST_ROOT);
  });
  afterEach(() => {
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  // ============================================================
  // createTask
  // ============================================================

  it('createTask 生成符合规范的 task', () => {
    const task = schemaMod.createTask({ description: 'test', goal: 'do it', priority: 'high' });

    assert(task.taskId.startsWith('task_'));
    assert(task.description === 'test');
    assert(task.goal === 'do it');
    assert(task.priority === 'high');
    assert(task.status === schemaMod.TaskStatus.PENDING);
    assert(task.executor === null);
    assert(task.lastExecutor === null);
    assert(task.completedAt === null);
    assert(task.lastHeartbeatAt === null);
    assert(Array.isArray(task.context));
    assert(task.context[0].type === 'input');
  });

  it('createTask 默认 priority 为 normal', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    assert(task.priority === 'normal');
  });

  it('createTask 默认 publisher 为 user', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    assert(task.publisher === 'user');
  });

  it('createTask input 参数放入 context[0]', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g', input: { key: 'value', num: 42 } });
    assert(task.context[0].type === 'input');
    assert(task.context[0].data.key === 'value');
    assert(task.context[0].data.num === 42);
  });

  // ============================================================
  // validateTask
  // ============================================================

  it('validateTask 正常任务通过', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    const result = schemaMod.validateTask(task);
    assert(result.valid === true, result.errors.join(', '));
  });

  it('validateTask 缺少 taskId 失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    delete task.taskId;
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('taskId')));
  });

  it('validateTask taskId 格式错误失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.taskId = 'bad_id';
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('task_')));
  });

  it('validateTask context[0].type 不是 input 失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.context[0].type = 'wrong';
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('context[0]')));
  });

  it('validateTask context[1] 缺少 executor 失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.context.push({ step: 'step1', output: {} });
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('context[1]') && e.includes('executor')));
  });

  it('validateTask context[1] 缺少 step 失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.context.push({ executor: 'agent_1', output: {} });
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('context[1]') && e.includes('step')));
  });

  it('validateTask status 无效值失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.status = 'invalid_status';
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('status')));
  });

  it('validateTask priority 无效值失败', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g', priority: 'super_high' });
    const result = schemaMod.validateTask(task);
    assert(result.valid === false);
    assert(result.errors.some(e => e.includes('priority')));
  });

  it('validateTask 非对象 task 失败', () => {
    const result = schemaMod.validateTask(null);
    assert(result.valid === false);
  });

  // ============================================================
  // TaskStatus / TaskPriority 常量
  // ============================================================

  it('TaskStatus 包含所有状态', () => {
    assert(schemaMod.TaskStatus.PENDING === 'pending');
    assert(schemaMod.TaskStatus.RUNNING === 'running');
    assert(schemaMod.TaskStatus.COMPLETED === 'completed');
    assert(schemaMod.TaskStatus.FAILED === 'failed');
    assert(schemaMod.TaskStatus.CANCELLED === 'cancelled');
  });

  it('TaskPriority 包含所有优先级', () => {
    assert(schemaMod.TaskPriority.HIGH === 'high');
    assert(schemaMod.TaskPriority.NORMAL === 'normal');
    assert(schemaMod.TaskPriority.LOW === 'low');
  });

  // ============================================================
  // workspace 路径函数
  // ============================================================

  it('setWorkspaceRoot / getWorkspaceRoot 正常工作', () => {
    assert(schemaMod.getWorkspaceRoot() === TEST_ROOT);
  });

  it('getTaskWorkspace 返回正确路径', () => {
    const ws = schemaMod.getTaskWorkspace('task_123');
    assert(ws === path.join(TEST_ROOT, 'task_123'));
  });

  it('ensureTaskWorkspace 创建目录', () => {
    const ws = schemaMod.ensureTaskWorkspace('task_mkdir');
    assert(fs.existsSync(ws));
    assert(fs.statSync(ws).isDirectory());
  });

  // ============================================================
  // formatTaskForHuman
  // ============================================================

  it('formatTaskForHuman 格式化 pending 任务', () => {
    const task = schemaMod.createTask({ description: 'build report', goal: 'analyze data', priority: 'high' });
    const output = schemaMod.formatTaskForHuman(task);
    assert(output.includes('build report'));
    assert(output.includes('analyze data'));
    assert(output.includes('🔴 高'));
    assert(output.includes('⏳ 待认领'));
  });

  it('formatTaskForHuman 显示上一步执行者', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.lastExecutor = 'agent_previous';
    const output = schemaMod.formatTaskForHuman(task);
    assert(output.includes('上一步: agent_previous'));
  });

  // ============================================================
  // getTaskSummary
  // ============================================================

  it('getTaskSummary 无 context 返回默认文字', () => {
    assert(schemaMod.getTaskSummary({}) === '（无上下文）');
  });

  it('getTaskSummary 只有 input 返回默认文字', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    assert(schemaMod.getTaskSummary(task).includes('暂无执行结果'));
  });

  it('getTaskSummary 返回 lastEntry.output.summary', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.context.push({ executor: 'a1', step: 's1', output: { summary: 'analysis done' }, completedAt: Date.now() });
    assert(schemaMod.getTaskSummary(task) === 'analysis done');
  });

  it('getTaskSummary 无 summary 但有 files 返回文件列表', () => {
    const task = schemaMod.createTask({ description: 'd', goal: 'g' });
    task.context.push({ executor: 'a1', step: 's1', output: { files: ['a.txt', 'b.log'] }, completedAt: Date.now() });
    const summary = schemaMod.getTaskSummary(task);
    assert(summary.includes('a.txt'));
    assert(summary.includes('b.log'));
  });
});
