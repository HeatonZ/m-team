const API = '/api';

export interface TaskLog {
  id: number;
  taskId: string;
  action: string;
  sessionKey: string | null;
  agentId: string | null;
  operator: string | null;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: number;
}

export async function fetchLogs(taskId?: string, action?: string, limit = 200): Promise<TaskLog[]> {
  const params = new URLSearchParams();
  if (taskId) params.set('taskId', taskId);
  if (action) params.set('action', action);
  params.set('limit', String(limit));
  const res = await fetch(`${API}/logs?${params}`);
  const data = await res.json();
  return data.logs as TaskLog[];
}
