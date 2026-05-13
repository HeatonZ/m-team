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

const STEP_MAX_LENGTH = 120;
const SUMMARY_MAX_LENGTH = 500;
const ISSUE_MAX_LENGTH = 180;
const FILE_PATH_MAX_LENGTH = 240;
const MAX_FILES = 20;
const MAX_ISSUES = 10;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim();
}

function sanitizeStepText(raw: string): string {
  const normalized = normalizeText(raw);
  return clipText(normalized, STEP_MAX_LENGTH);
}

function uniqStrings(items: string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = clipText(normalizeText(item), maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }

  return output;
}

export interface ContextStepOutput {
  summary?: string;
  files?: string[];
  unresolvedIssues?: string[];
  error?: string;
  [key: string]: unknown;
}

function normalizeContextStepOutput(raw: unknown): ContextStepOutput {
  const output = (raw && typeof raw === 'object' ? raw : {}) as ContextStepOutput;

  const summary = typeof output.summary === 'string'
    ? clipText(normalizeText(output.summary), SUMMARY_MAX_LENGTH)
    : undefined;

  const files = Array.isArray(output.files)
    ? uniqStrings(output.files.filter((item): item is string => typeof item === 'string'), MAX_FILES, FILE_PATH_MAX_LENGTH)
    : [];

  const unresolvedIssues = Array.isArray(output.unresolvedIssues)
    ? uniqStrings(output.unresolvedIssues.filter((item): item is string => typeof item === 'string'), MAX_ISSUES, ISSUE_MAX_LENGTH)
    : [];

  const error = typeof output.error === 'string'
    ? clipText(normalizeText(output.error), ISSUE_MAX_LENGTH)
    : undefined;

  return {
    ...(summary ? { summary } : {}),
    ...(files.length ? { files } : {}),
    ...(unresolvedIssues.length ? { unresolvedIssues } : {}),
    ...(error ? { error } : {}),
  };
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
    .map((entry) => ({
      ...entry,
      step: sanitizeStepText(entry.step),
      output: normalizeContextStepOutput(entry.output),
    }))
    .filter((entry) => entry.step.length > 0);

  return {
    ...task,
    description: sanitizeStepText(String(task.description ?? '')),
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
      if (entry.type !== 'step') errors.push(`context[${i}].type must be step`);
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

export function getStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}
