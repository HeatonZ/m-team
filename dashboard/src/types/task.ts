export type TaskStatus = 'pending' | 'running' | 'completed' | 'closed' | 'failed' | 'cancelled';
export type TaskPriority = 'high' | 'normal' | 'low';

export interface ContextInputEntry {
  type: 'input';
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ContextStepEntry {
  type?: string;
  executor: string;
  step: string;
  output?: {
    summary?: string;
    files?: string[];
  };
  completedAt?: number;
}

export type ContextEntry = ContextInputEntry | ContextStepEntry;

export interface Task {
  taskId: string;
  goal: string;
  description: string;
  context: ContextEntry[];
  priority: TaskPriority;
  status: TaskStatus;
  publisher: string;
  executor: string | null;
  lastExecutor: string | null;
  createdAt: number;
  completedAt: number | null;
  updatedAt: number;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '⏳ 待认领',
  running: '⚙️ 执行中',
  completed: '✅ 完成（待验收）',
  closed: '🔒 已验收',
  failed: '❌ 失败',
  cancelled: '🚫 已取消',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: '🔴 高',
  normal: '🟡 中',
  low: '🟢 低',
};

export const HISTORY_STATUSES: TaskStatus[] = ['completed', 'closed', 'failed', 'cancelled'];
