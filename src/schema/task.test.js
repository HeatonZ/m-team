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
      const task = createTask({ description: '测试任务' });
      expect(task.taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(task.description).toBe('测试任务');
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.priority).toBe('normal');
      expect(task.publisher).toBe('user');
      expect(task.executor).toBeNull();
      expect(task.input).toEqual({});
    });

    it('支持自定义 publisher 和 priority', () => {
      const task = createTask({
        description: '高优任务',
        publisher: 'manager',
        priority: 'high',
        input: { url: 'https://example.com' }
      });
      expect(task.publisher).toBe('manager');
      expect(task.priority).toBe('high');
      expect(task.input).toEqual({ url: 'https://example.com' });
    });

    it('指定 executor 时任务直接进入 claimed 状态', () => {
      const task = createTask({
        description: '指定执行者',
        executor: 'agent_1'
      });
      expect(task.executor).toBe('agent_1');
      expect(task.status).toBe(TaskStatus.CLAIMED);
      expect(task.claimedAt).not.toBeNull();
    });

    it('executor 为空时任务保持 pending', () => {
      const task = createTask({ description: '待认领' });
      expect(task.executor).toBeNull();
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.claimedAt).toBeNull();
    });

    it('priority 接受大小写混合输入', () => {
      // 内部不做 normalize，直接存储原值
      const task = createTask({ description: 'x', priority: 'HIGH' });
      expect(task.priority).toBe('HIGH');
    });

    it('createdAt 是时间戳', () => {
      const before = Date.now();
      const task = createTask({ description: 'x' });
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
      const task = createTask({ description: '有效任务' });
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
      const result = validateTask({ description: 'x', status: TaskStatus.PENDING, priority: 'normal' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('taskId'))).toBe(true);
    });

    it('taskId 不以 task_ 开头返回无效', () => {
      const result = validateTask({
        taskId: 'invalid',
        description: 'x',
        status: TaskStatus.PENDING,
        priority: 'normal'
      });
      expect(result.valid).toBe(false);
    });

    it('缺少 description 返回无效', () => {
      const task = createTask({ description: 'x' });
      delete task.description;
      const result = validateTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('description'))).toBe(true);
    });

    it('无效 priority 返回无效', () => {
      const task = createTask({ description: 'x' });
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
      expect(getStatusLabel('claimed')).toBe('🔄 已认领');
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
    it('有 summary 时返回 summary', () => {
      const task = { summary: '完成的了' };
      expect(getTaskSummary(task)).toBe('完成的了');
    });

    it('无 result 时返回默认值', () => {
      expect(getTaskSummary({})).toBe('（无结果）');
    });

    it('result 是简单值时返回 toString', () => {
      expect(getTaskSummary({ result: 42 })).toBe('42');
    });

    it('result 是对象且字段 <= 3 时返回键值对', () => {
      const task = { result: { code: 0, message: 'ok' } };
      // JSON.stringify 会对字符串值加引号，所以是 "ok" 而非 ok
      expect(getTaskSummary(task)).toBe('code: 0, message: "ok"');
    });

    it('result 是对象且字段 > 3 时截断', () => {
      const task = { result: { a: 1, b: 2, c: 3, d: 4 } };
      const summary = getTaskSummary(task);
      expect(summary).toContain('4 个字段');
      expect(summary).toContain('a, b, c');
    });

    it('result 是长字符串时截断到 200 字符', () => {
      const longStr = 'x'.repeat(300);
      const summary = getTaskSummary({ result: longStr });
      expect(summary.length).toBe(200);
    });
  });

  // ============================================================
  // formatTaskForHuman
  // ============================================================
  describe('formatTaskForHuman', () => {
    it('生成包含所有字段的字符串', () => {
      const task = createTask({ description: '测试', priority: 'high' });
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('测试');
      expect(formatted).toContain('🔴 高'); // high = 🔴 高
      expect(formatted).toContain('⏳ 待认领');
    });

    it('有 executor 时包含执行者', () => {
      const task = createTask({ description: 'x' });
      task.executor = 'agent_1';
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('执行者: agent_1');
    });

    it('无 executor 时不包含执行者', () => {
      const task = createTask({ description: 'x' });
      const formatted = formatTaskForHuman(task);
      expect(formatted).not.toContain('执行者:');
    });

    it('有 summary 时包含摘要', () => {
      const task = createTask({ description: 'x' });
      task.summary = 'done';
      const formatted = formatTaskForHuman(task);
      expect(formatted).toContain('摘要: done');
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
