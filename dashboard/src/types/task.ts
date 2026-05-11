export type TaskStatus = 'pending' | 'running' | 'completed' | 'closed' | 'failed' | 'cancelled';
export type TaskPriority = 'high' | 'normal' | 'low';
export type TaskType = 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content';

export interface ContextStepOutput {
  summary?: string;
  files?: string[];
  dataRefs?: string[];
  completionNote?: string;
  handoffNote?: string;
  unresolvedIssues?: string[];
  error?: string;
  metrics?: Record<string, number | string>;
}

export interface ContextStepEntry {
  type: 'step';
  executor: string;
  step: string;
  output?: ContextStepOutput;
  completedAt?: number;
}

export type ContextEntry = ContextStepEntry;

export interface Task {
  taskId: string;
  taskType?: TaskType;
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
  completed: '✅ 待验收',
  closed: '🔒 已验收',
  failed: '❌ 失败',
  cancelled: '🚫 已取消',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: '🔴 高',
  normal: '🟡 中',
  low: '🟢 低',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: '通用',
  coding: '代码',
  research: '调研',
  ops: '运维',
  data: '数据',
  design: '设计',
  content: '内容',
};

export const HISTORY_STATUSES: TaskStatus[] = ['completed', 'closed', 'failed', 'cancelled'];
