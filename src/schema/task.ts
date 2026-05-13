/**
 * M-Team task domain model.
 */

export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];
export const TASK_STATUSES: TaskStatus[] = Object.values(TaskStatus);

export const TaskPriority = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
} as const;

export type TaskPriority = typeof TaskPriority[keyof typeof TaskPriority];
export const VALID_PRIORITIES: TaskPriority[] = Object.values(TaskPriority);

export const TaskType = {
  GENERAL: 'general',
  CODING: 'coding',
  RESEARCH: 'research',
  OPS: 'ops',
  DATA: 'data',
  DESIGN: 'design',
  CONTENT: 'content',
} as const;

export type TaskType = typeof TaskType[keyof typeof TaskType];
export const VALID_TASK_TYPES: TaskType[] = Object.values(TaskType);

export interface ContextStepOutput {
  summary?: string;
  files?: string[];
  dataRefs?: string[];
  completionNote?: string;
  handoffNote?: string;
  unresolvedIssues?: string[];
  error?: string;
  metrics?: Record<string, number | string>;
  [key: string]: unknown;
}

export interface ContextStepEntry {
  type: 'step';
  executor: string;
  step: string;
  output: ContextStepOutput;
  completedAt: number;
}

export type ContextEntry = ContextStepEntry;

export interface Task {
  taskId: string;
  taskType: TaskType;
  goal: string;
  description: string;
  context: ContextEntry[];
  priority: TaskPriority;
  publisher: string;
  status: TaskStatus;
  executor: string | null;
  lastExecutor: string | null;
  createdAt: number;
  completedAt: number | null;
  updatedAt: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function normalizeTask(task: Task): Task {
  const normalizedContext = (task.context ?? [])
    .filter((entry): entry is ContextStepEntry => {
      return entry?.type === 'step'
        && typeof entry.executor === 'string'
        && typeof entry.step === 'string'
        && typeof entry.completedAt === 'number';
    })
    .map(entry => ({
      ...entry,
      output: entry.output ?? {},
    }));

  return {
    ...task,
    context: normalizedContext,
  };
}

export function validateTask(task: unknown): ValidationResult {
  const errors: string[] = [];

  if (!task || typeof task !== 'object') {
    return { valid: false, errors: ['task must be an object'] };
  }

  const t = task as Record<string, unknown>;

  if (!t.taskId || !String(t.taskId).startsWith('task_')) {
    errors.push('taskId must look like task_{timestamp}');
  }
  if (!t.description || typeof t.description !== 'string') {
    errors.push('description is required and must be a string');
  }
  if (!t.goal || typeof t.goal !== 'string') {
    errors.push('goal is required and must be a string');
  }
  if (t.taskType && !VALID_TASK_TYPES.includes(t.taskType as TaskType)) {
    errors.push(`taskType must be one of: ${VALID_TASK_TYPES.join(', ')}`);
  }
  if (Array.isArray(t.context)) {
    for (let i = 0; i < t.context.length; i++) {
      const entry = t.context[i] as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') {
        errors.push(`context[${i}] must be an object`);
        continue;
      }
      if (entry.type != 'step') errors.push(`context[${i}].type must be step`);
      if (!entry.executor || typeof entry.executor !== 'string') errors.push(`context[${i}].executor must be a string`);
      if (!entry.step || typeof entry.step !== 'string') errors.push(`context[${i}].step must be a string`);
    }
  }
  if (!TASK_STATUSES.includes(t.status as TaskStatus)) {
    errors.push(`status must be one of: ${TASK_STATUSES.join(', ')}`);
  }
  if (t.priority && !VALID_PRIORITIES.includes(t.priority as TaskPriority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

export interface TaskPatch {
  taskType?: TaskType;
  status?: TaskStatus;
  executor?: string | null;
  lastExecutor?: string | null;
  description?: string;
  context?: string;
  completedAt?: number | null;
  updatedAt?: number;
}

export interface CreateTaskInput {
  taskType?: TaskType;
  goal: string;
  description: string;
  publisher?: string;
  priority?: TaskPriority;
}

export function createTask(input: CreateTaskInput): Task {
  const {
    taskType = TaskType.GENERAL,
    goal,
    description,
    publisher = 'user',
    priority = TaskPriority.NORMAL,
  } = input;

  return {
    taskId: `task_${Date.now()}`,
    taskType,
    description: String(description),
    goal: String(goal),
    context: [],
    priority,
    publisher: publisher || 'user',
    status: TaskStatus.PENDING,
    executor: null,
    lastExecutor: null,
    createdAt: Date.now(),
    completedAt: null,
    updatedAt: Date.now(),
  };
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: 'Pending',
  [TaskStatus.RUNNING]: 'Running',
  [TaskStatus.COMPLETED]: 'Completed (awaiting acceptance)',
  [TaskStatus.CLOSED]: 'Closed',
  [TaskStatus.FAILED]: 'Failed',
  [TaskStatus.CANCELLED]: 'Cancelled',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.HIGH]: 'High',
  [TaskPriority.NORMAL]: 'Normal',
  [TaskPriority.LOW]: 'Low',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  [TaskType.GENERAL]: 'General',
  [TaskType.CODING]: 'Coding',
  [TaskType.RESEARCH]: 'Research',
  [TaskType.OPS]: 'Ops',
  [TaskType.DATA]: 'Data',
  [TaskType.DESIGN]: 'Design',
  [TaskType.CONTENT]: 'Content',
};

export function getTaskTypeLabel(taskType: TaskType): string {
  return TASK_TYPE_LABELS[taskType] ?? taskType;
}

export function getStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatTaskForHuman(input: Task): string {
  const task = normalizeTask(input);
  const lines: string[] = [
    `Goal: ${task.goal}`,
    `Type: ${getTaskTypeLabel(task.taskType)}`,
    `Current step: ${task.description}`,
    `ID: ${task.taskId}`,
    `Priority: ${PRIORITY_LABELS[task.priority] ?? 'Normal'}`,
    `Status: ${getStatusLabel(task.status)}`,
  ];

  const stepCount = task.context.length;
  lines.push(stepCount === 0 ? 'No step completed yet' : `Completed ${stepCount} step(s)`);
  if (task.executor) lines.push(`Executor: ${task.executor}`);
  if (task.lastExecutor) lines.push(`Last executor: ${task.lastExecutor}`);

  return lines.join('\n');
}

export function getTaskSummary(input: Task): string {
  const task = normalizeTask(input);
  if (!task.context || task.context.length === 0) return '(no context)';

  const last = task.context[task.context.length - 1];
  if (last.output?.summary) return last.output.summary;
  if (last.output?.files?.length) return `[files] ${last.output.files.join(', ')}`;
  if (last.output?.handoffNote) return last.output.handoffNote;
  return '(no summary)';
}
