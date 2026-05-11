/**
 * M-Team 任务域类型
 */

// ============================================================
// 枚举
// ============================================================

export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CLOSED: 'closed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const TASK_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.RUNNING,
  TaskStatus.COMPLETED,
  TaskStatus.CLOSED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED
];

export const TaskPriority = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
} as const;

export type TaskPriority = typeof TaskPriority[keyof typeof TaskPriority];

export const VALID_PRIORITIES: TaskPriority[] = [
  TaskPriority.HIGH,
  TaskPriority.NORMAL,
  TaskPriority.LOW
];

export const TaskType = {
  GENERAL: 'general',
  CODING: 'coding',
  RESEARCH: 'research',
  OPS: 'ops',
  DATA: 'data',
  DESIGN: 'design',
  CONTENT: 'content'
} as const;

export type TaskType = typeof TaskType[keyof typeof TaskType];

export const VALID_TASK_TYPES: TaskType[] = [
  TaskType.GENERAL,
  TaskType.CODING,
  TaskType.RESEARCH,
  TaskType.OPS,
  TaskType.DATA,
  TaskType.DESIGN,
  TaskType.CONTENT
];

// ============================================================
// 核心类型
// ============================================================

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

/**
 * M-Team 任务 — 内存中的完整任务对象
 *
 * goal / taskType / description 的职责分离：
 * - taskType：认领前的粗筛类型
 * - description：当前这一步做什么，executor 认领时主要依据它
 * - goal：任务终态标尺，用于 agent_end 终态判断与 publisher 验收，不参与认领
 */
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

// ============================================================
// 校验
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function normalizeTask(task: Task): Task {
  const normalizedContext = (task.context ?? []).filter((entry): entry is ContextStepEntry => {
    return entry?.type === 'step'
      && typeof entry.executor === 'string'
      && typeof entry.step === 'string'
      && typeof entry.completedAt === 'number';
  }).map(entry => ({
    ...entry,
    output: entry.output ?? {}
  }));

  return {
    ...task,
    context: normalizedContext,
  };
}

export function validateTask(task: unknown): ValidationResult {
  const errors: string[] = [];

  if (!task || typeof task !== 'object') {
    return { valid: false, errors: ['task 必须是对象'] };
  }

  const t = task as Record<string, unknown>;

  if (!t.taskId || !String(t.taskId).startsWith('task_')) {
    errors.push('taskId 格式无效，应为 task_{Date.now()}');
  }
  if (!t.description || typeof t.description !== 'string') {
    errors.push('description 必填且为字符串');
  }
  if (!t.goal || typeof t.goal !== 'string') {
    errors.push('goal 必填且为字符串');
  }
  if (t.taskType && !VALID_TASK_TYPES.includes(t.taskType as TaskType)) {
    errors.push(`taskType 无效，可选值: ${VALID_TASK_TYPES.join(', ')}`);
  }
  if (Array.isArray(t.context)) {
    for (let i = 0; i < t.context.length; i++) {
      const entry = t.context[i] as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') {
        errors.push(`context[${i}] 必须是对象`);
        continue;
      }
      if (entry.type !== 'step') {
        errors.push(`context[${i}].type 必须是 step`);
      }
      if (!entry.executor || typeof entry.executor !== 'string') {
        errors.push(`context[${i}].executor 必填且为字符串`);
      }
      if (!entry.step || typeof entry.step !== 'string') {
        errors.push(`context[${i}].step 必填且为字符串`);
      }
    }
  }
  if (!TASK_STATUSES.includes(t.status as TaskStatus)) {
    errors.push(`status 无效，可选值: ${TASK_STATUSES.join(', ')}`);
  }
  if (t.priority && !VALID_PRIORITIES.includes(t.priority as TaskPriority)) {
    errors.push(`priority 无效，可选值: ${VALID_PRIORITIES.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Patch（用于 updateTaskRow）
// ============================================================

export interface TaskPatch {
  taskType?: TaskType;
  status?: TaskStatus;
  executor?: string | null;
  lastExecutor?: string | null;
  description?: string;
  context?: string; // JSON stringified ContextEntry[]
  completedAt?: number | null;
  updatedAt?: number;
}

// ============================================================
// 构造
// ============================================================

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
    priority = TaskPriority.NORMAL
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
    updatedAt: Date.now()
  };
}

// ============================================================
// 格式化（对外展示）
// ============================================================

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '⏳ 待认领',
  [TaskStatus.RUNNING]: '⚙️ 执行中',
  [TaskStatus.COMPLETED]: '✅ 完成（待验收）',
  [TaskStatus.CLOSED]: '🔒 已验收',
  [TaskStatus.FAILED]: '❌ 失败',
  [TaskStatus.CANCELLED]: '🚫 已取消'
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.HIGH]: '🔴 高',
  [TaskPriority.NORMAL]: '🟡 中',
  [TaskPriority.LOW]: '🟢 低'
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  [TaskType.GENERAL]: '通用',
  [TaskType.CODING]: '代码',
  [TaskType.RESEARCH]: '调研',
  [TaskType.OPS]: '运维',
  [TaskType.DATA]: '数据',
  [TaskType.DESIGN]: '设计',
  [TaskType.CONTENT]: '内容'
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
    `🎯 ${task.goal}`,
    `🏷️ 类型: ${getTaskTypeLabel(task.taskType)}`,
    `📋 当前：${task.description}`,
    `ID: ${task.taskId}`,
    `优先级: ${PRIORITY_LABELS[task.priority] ?? '🟡 中'}`,
    `状态: ${getStatusLabel(task.status)}`
  ];

  const stepCount = task.context.length;
  if (stepCount === 0) {
    lines.push('📝 还未开始执行');
  } else {
    lines.push(`📝 已完成 ${stepCount} 步`);
  }

  if (task.executor) lines.push(`执行者: ${task.executor}`);
  if (task.lastExecutor) lines.push(`上一步: ${task.lastExecutor}`);

  return lines.join('\n');
}

export function getTaskSummary(input: Task): string {
  const task = normalizeTask(input);
  if (!task.context || task.context.length === 0) return '（无上下文）';

  const last = task.context[task.context.length - 1];
  if (last.output?.summary) return last.output.summary;
  if (last.output?.files?.length) return `[文件] ${last.output.files.join(', ')}`;
  if (last.output?.handoffNote) return last.output.handoffNote;
  return '（无摘要）';
}
