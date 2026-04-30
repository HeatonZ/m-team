import type { Task } from '../types/task';

const API = '/api';

export async function fetchPendingTasks(): Promise<Task[]> {
  const res = await fetch(`${API}/tasks/pending`);
  const data = await res.json();
  return data.tasks as Task[];
}

export async function fetchRunningTasks(): Promise<Task[]> {
  const res = await fetch(`${API}/tasks/running`);
  const data = await res.json();
  return data.tasks as Task[];
}

export async function fetchHistoryTasks(status: 'completed' | 'failed' | 'cancelled'): Promise<Task[]> {
  const res = await fetch(`${API}/tasks/history?status=${status}`);
  const data = await res.json();
  return data.tasks as Task[];
}

export async function fetchTaskDetail(taskId: string): Promise<Task> {
  const res = await fetch(`${API}/tasks/${taskId}`);
  if (!res.ok) throw new Error('Task not found');
  return res.json() as Promise<Task>;
}
