const API = '/api';

export interface TaskLog {
  id: number;
  taskId: string;
  action: string;
  sessionKey: string | null;
  agentId: string | null;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
}

export interface LogsResponse {
  logs: TaskLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FetchLogsOptions {
  taskId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchLogs(options: FetchLogsOptions = {}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (options.taskId) params.set('taskId', options.taskId);
  if (options.action) params.set('action', options.action);
  params.set('page', String(options.page ?? 1));
  params.set('pageSize', String(options.pageSize ?? 20));

  const res = await fetch(`${API}/logs?${params}`);
  const data = await res.json();
  return {
    logs: data.logs as TaskLog[],
    total: Number(data.total ?? data.logs?.length ?? 0),
    page: Number(data.page ?? options.page ?? 1),
    pageSize: Number(data.pageSize ?? options.pageSize ?? 20),
    totalPages: Number(data.totalPages ?? 0),
  };
}
