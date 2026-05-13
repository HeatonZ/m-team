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
  decision: {
    decision: 'next' | 'complete' | 'fail' | null;
    via: string | null;
    reason: string | null;
    nextDescription: string | null;
    nextTaskType: string | null;
    confidence: string | null;
    llmStatus: 'ok' | 'error' | null;
    llmError: string | null;
    llmAttempts: number | null;
    hasFallback: boolean;
  } | null;
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
  agentId?: string;
  sessionKey?: string;
  decision?: 'next' | 'complete' | 'fail';
  via?: 'llm' | 'llm_fail_fast' | 'llm_repeat_guard';
  llmStatus?: 'ok' | 'error';
  hasError?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchLogs(options: FetchLogsOptions = {}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (options.taskId) params.set('taskId', options.taskId);
  if (options.action) params.set('action', options.action);
  if (options.agentId) params.set('agentId', options.agentId);
  if (options.sessionKey) params.set('sessionKey', options.sessionKey);
  if (options.decision) params.set('decision', options.decision);
  if (options.via) params.set('via', options.via);
  if (options.llmStatus) params.set('llmStatus', options.llmStatus);
  if (typeof options.hasError === 'boolean') params.set('hasError', String(options.hasError));
  if (options.keyword) params.set('keyword', options.keyword);
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
