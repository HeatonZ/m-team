import type { Task, TaskStatus } from '../types/task';

const BASE = '/api';

type HistoryTasksResponse = {
  tasks: Task[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API PATCH ${path} -> ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPendingTasks(): Promise<Task[]> {
  const data = await get<{ tasks: Task[] }>('/tasks/pending');
  return data.tasks;
}

export async function fetchRunningTasks(): Promise<Task[]> {
  const data = await get<{ tasks: Task[] }>('/tasks/running');
  return data.tasks;
}

export async function fetchHistoryTasks(status: TaskStatus, page = 1): Promise<HistoryTasksResponse> {
  return get<HistoryTasksResponse>(`/tasks/history?status=${status}&page=${page}`);
}

export async function fetchTaskDetail(taskId: string): Promise<Task> {
  return get<Task>(`/tasks/${taskId}`);
}

export interface EditTaskPayload {
  goal?: string;
  description?: string;
  status?: TaskStatus;
  taskType?: Task['taskType'];
  priority?: Task['priority'];
  publisher?: string;
  executor?: string | null;
  lastExecutor?: string | null;
}

export async function editTask(taskId: string, payload: EditTaskPayload): Promise<Task> {
  const data = await patch<{ task: Task }>(`/tasks/${taskId}`, payload);
  return data.task;
}
