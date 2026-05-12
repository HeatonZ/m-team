export type TaskStatus = 'pending' | 'running' | 'completed' | 'closed' | 'failed' | 'cancelled';
export type TaskPriority = 'high' | 'normal' | 'low';
export type TaskType = 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content';

export interface StepContract {
  expectedOutcome?: string;
  doneWhen: string[];
  constraints?: string[];
  inputHints?: string[];
}

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
  stepContract?: StepContract;
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
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed / Awaiting acceptance',
  closed: 'Closed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: 'General',
  coding: 'Coding',
  research: 'Research',
  ops: 'Ops',
  data: 'Data',
  design: 'Design',
  content: 'Content',
};

export const HISTORY_STATUSES: TaskStatus[] = ['completed', 'closed', 'failed', 'cancelled'];
