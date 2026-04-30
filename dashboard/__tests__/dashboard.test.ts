import { describe, it, expect, beforeAll } from 'vitest';
import { setWorkspaceRoot, getPendingTasks, getRunningTasks, getAllTasks, getTask as getTaskById } from '../src/db.ts';
import { TaskStatus } from 'm-team/schema/task';

beforeAll(() => {
  setWorkspaceRoot('/mnt/d/code/m-team');
});

describe('pending list', () => {
  it('returns only pending tasks', () => {
    const tasks = getPendingTasks();
    expect(Array.isArray(tasks)).toBe(true);
    tasks.forEach(t => expect(t.status).toBe(TaskStatus.PENDING));
  });
});

describe('running list', () => {
  it('returns only running tasks', () => {
    const tasks = getRunningTasks();
    expect(Array.isArray(tasks)).toBe(true);
    tasks.forEach(t => expect(t.status).toBe(TaskStatus.RUNNING));
  });
});

describe('history list — completed', () => {
  it('returns completed tasks', () => {
    const tasks = getAllTasks().filter(t => t.status === TaskStatus.COMPLETED);
    expect(Array.isArray(tasks)).toBe(true);
    tasks.forEach(t => expect(t.status).toBe(TaskStatus.COMPLETED));
  });
});

describe('history list — failed', () => {
  it('returns failed tasks', () => {
    const tasks = getAllTasks().filter(t => t.status === TaskStatus.FAILED);
    expect(Array.isArray(tasks)).toBe(true);
    tasks.forEach(t => expect(t.status).toBe(TaskStatus.FAILED));
  });
});

describe('task detail', () => {
  it('can read any task by id', () => {
    const all = getAllTasks();
    if (all.length === 0) return;
    const task = getTaskById(all[0].taskId);
    expect(task).not.toBeNull();
    expect(task).toBeDefined();
    expect(task!.taskId).toBe(all[0].taskId);
  });

  it('returns null for non-existent task', () => {
    const task = getTaskById('task_nonexistent_99999');
    expect(task).toBeNull();
  });

  it('includes context with at least the input entry', () => {
    const all = getAllTasks();
    if (all.length === 0) return;
    const task = getTaskById(all[0].taskId);
    expect(Array.isArray(task!.context)).toBe(true);
    expect(task!.context.length).toBeGreaterThanOrEqual(1);
    expect(task!.context[0].type).toBe('input');
  });
});

describe('task fields', () => {
  it('has all required fields', () => {
    const all = getAllTasks();
    if (all.length === 0) return;
    const t = all[0];
    const required = ['taskId', 'description', 'goal', 'context', 'status', 'priority', 'publisher', 'createdAt'] as const;
    required.forEach(f => expect(f in t).toBe(true));
  });
});
