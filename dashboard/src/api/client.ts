import type { Task, TaskStatus } from '../types/task';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as T;
}

export async function fetchPendingTasks(): Promise<Task[]> {
  const data = await get<{ tasks: Task[] }>('/tasks/pending');
  return data.tasks;
}

export async function fetchRunningTasks(): Promise<Task[]> {
  const data = await get<{ tasks: Task[] }>('/tasks/running');
  return data.tasks;
}

export async function fetchHistoryTasks(status: TaskStatus): Promise<Task[]> {
  const data = await get<{ tasks: Task[] }>(`/tasks/history?status=${status}`);
  return data.tasks;
}

export async function fetchTaskDetail(taskId: string): Promise<Task> {
  return get<Task>(`/tasks/${taskId}`);
}
