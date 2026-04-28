/**
 * @license MIT
 * M-Team Plugin — 去中心化任务池协作
 */

import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  TaskPriority,
  VALID_PRIORITIES,
  createTask,
  validateTask,
  getStatusLabel,
  getTaskSummary,
  formatTaskForHuman,
  getTaskWorkspace,
  ensureTaskWorkspace,
  setWorkspaceRoot
} from './task.js';
import fs from 'node:fs';
import path from 'node:path';

describe('task schema', () => {
  // ============================================================
  // createTask
  // ============================================================
  describe('createTask', () => {
    it('生成有效任务对象', () => {
      const task = createTask({ description: '测试任务', goal: '测试goal' });
      expect(task.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(task.description).toBe('测试任务');
      expect(task.goal).toBe('测试goal');
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.priority).toBe('normal');
      expect(task.publisher).toBe('user');
      expect(task.executor).toBeNull();
      expect(task.context).toEqual([
        { type: 'input', data: {}, createdAt: task.context[0].createdAt }
      ]);
    });

    it('context 第一个 entry 是 input 类型', () => {
      const task = createTask({
        description: '测试',
        goal: 'goal',
        input: { keyword: '收纳箱', count: 10 }
      });
      expect(task.context[0].type).toBe('input');
      expect(task.context[0].data).toEqual({ keyword: '收纳箱', count: 10 });
    });

    it('支持自定义 publisher 和 priority', () => {
      const task = createTask({
        description: '高优任务',
        goal: '核心目标A',
        publisher: 'manager',
        priority: 'high'
      });
      expect(task.publisher).toBe('manager');
      expect(task.priority).toBe('high');
    });

    it('createdAt 是时间戳', () => {
      const before = Date.now();
      const task = createTask({ description: 'x', goal: 'goal' });
      const after = Date.now();
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.createdAt).toBeLessThanOrEqual(after);
    });
  });

  // ============================================================
  // validateTask
  // ============================================================
  describe('validateTask', () => {
    it('有效任务通过验证', () => {
      const task = createTask({ description: '有效任务', goal: 'goal' });
      const result = validateTask(task);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('非对象返回无效', () => {
      const result = validateTask(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('task 必须是对象');
    });

    it('缺少 taskId 返回无效', () => {
      const result = validateTask({ description: 'x', goal: 'y', status: TaskStatus.PENDING, priority: 'normal', context: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('taskId'))).toBe(true);
    });

    it('taskId 不以 task_ 开头返回无效', () => {
      const result = validateTask({
        taskId: 'invalid',
        description: 'x',
        goal: 'y',
        status: TaskStatus.PENDING,
        priority: 'normal',
        context: []
      });
      expect(result.valid).toBe(false);
    });

    it('缺少 description 返回无效', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      delete task.description;
      const result = validateTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('description'))).toBe(true);
    });

    it('缺少 goal 返回无效', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      delete task.goal;
      const result = validateTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('goal'))).toBe(true);
    });

    it('context 不是数组返回无效', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.context = 'not-array';
      const result = validateTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('context'))).toBe(true);
    });

    it('无效 priority 返回无效', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.priority = 'urgent';
      const result = validateTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('priority'))).toBe(true);
    });

    it('返回所有错误而非短路', () => {
      const result = validateTask({});
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  // ============================================================
  // getStatusLabel
  // ============================================================
  describe('getStatusLabel', () => {
    it('每种状态返回对应标签', () => {
      expect(getStatusLabel('pending')).toBe('⏳ 待认领');
      expect(getStatusLabel('running')).toBe('⚙️ 执行中');
      expect(getStatusLabel('completed')).toBe('✅ 完成');
      expect(getStatusLabel('failed')).toBe('❌ 失败');
    });

    it('未知状态原样返回', () => {
      expect(getStatusLabel('unknown_status')).toBe('unknown_status');
    });
  });

  // ============================================================
  // getTaskSummary
  // ============================================================
  describe('getTaskSummary', () => {
    it('只有 input entry 时返回默认值', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      expect(getTaskSummary(task)).toBe('（初始输入，暂无执行结果）');
    });

    it('最后一个 entry 有 summary 时返回 summary', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.context.push({
        executor: 'agent_1',
        step: '搜索',
        output: { summary: '找到10家供应商' },
        completedAt: Date.now()
      });
      expect(getTaskSummary(task)).toBe('找到10家供应商');
    });

    it('最后一个 entry 有 files 但无 summary 时返回文件列表', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.context.push({
        executor: 'agent_1',
        step: '搜索',
        output: { files: ['data/suppliers.json', 'data/prices.csv'] },
        completedAt: Date.now()
      });
      expect(getTaskSummary(task)).toBe('[文件] data/suppliers.json, data/prices.csv');
    });

    it('最后一个 entry 无 summary 也无 files 时返回默认值', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.context.push({
        executor: 'agent_1',
        step: '搜索',
        output: {},
        completedAt: Date.now()
      });
      expect(getTaskSummary(task)).toBe('（无摘要）');
    });
  });

  // ============================================================
  // formatTaskForHuman
  // ============================================================
  describe('formatTaskForHuman', () => {
    it('生成包含所有字段的字符串', () => {
      const task = createTask({ description: '测试', goal: '目标', priority: 'high' });
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('目标');
      expect(formatted).toContain('🔴 高');
      expect(formatted).toContain('⏳ 待认领');
      expect(formatted).toContain('步骤历史: 1 步');
    });

    it('有 executor 时包含执行者', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.executor = 'agent_1';
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('执行者: agent_1');
    });

    it('无 executor 时不包含执行者', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      const formatted = formatTaskForHuman(task);
      expect(formatted).not.toContain('执行者:');
    });

    it('有 lastExecutor 时包含上一步', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.lastExecutor = 'agent_1';
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('上一步: agent_1');
    });

    it('context 步骤数正确显示', () => {
      const task = createTask({ description: 'x', goal: 'goal' });
      task.context.push({ executor: 'a', step: 's1', output: {}, completedAt: Date.now() });
      task.context.push({ executor: 'b', step: 's2', output: {}, completedAt: Date.now() });
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('步骤历史: 3 步');
    });
  });

  // ============================================================
  // 路径函数
  // ============================================================
  describe('workspace paths', () => {
    it('getTaskWorkspace 拼接 taskId', () => {
      setWorkspaceRoot('/tmp/mteam-test');
      expect(getTaskWorkspace('task_1_abc')).toBe('/tmp/mteam-test/task_1_abc');
    });

    it('ensureTaskWorkspace 创建目录', () => {
      const testRoot = fs.mkdtempSync('/tmp/mteam-workspace-');
      setWorkspaceRoot(testRoot);
      const ws = ensureTaskWorkspace('task_999_xyz');
      expect(fs.existsSync(ws)).toBe(true);
      fs.rmSync(testRoot, { recursive: true, force: true });
    });
  });
});
