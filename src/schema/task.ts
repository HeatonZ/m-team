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
  FAILED: 'failed',
  CANCELLED: 'cancelled'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const TASK_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.RUNNING,
  TaskStatus.COMPLETED,
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

// ============================================================
// 核心类型
// ============================================================

/** 任务上下文条目 */
export interface ContextInputEntry {
  type: 'input';
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ContextStepEntry {
  type: 'step';
  executor: string;
  step: string;
  output: ContextStepOutput;
  completedAt: number;
}

export type ContextEntry = ContextInputEntry | ContextStepEntry;

export interface ContextStepOutput {
  summary?: string;
  files?: string[];
  error?: string;
  [key: string]: unknown;
}

/**
 * M-Team 任务 — 内存中的完整任务对象
 *
 * goal 与 description 的职责分离：
 * - goal：任务目标，executor 凭此判断任务是否适合自己，应有区分度
 * - description：当前这一步做什么，每次 relay 时由上一个 executor 填写下一步
 */
export interface Task {
  taskId: string;
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
  lastHeartbeatAt: number | null;
}

// ============================================================
// 校验
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTask(task: unknown): ValidationResult {
  const errors: string[] = [];

  if (!task || typeof task !== 'object') {
    return { valid: false, errors: ['task 必须是对象'] };
  }

  const t = task as Record<string, unknown>;

  if (!t.taskId || !String(t.taskId).startsWith('task_')) {
    errors.push('taskId 格式无效，应为 task_{unix_timestamp}');
  }
  if (!t.description || typeof t.description !== 'string') {
    errors.push('description 必填且为字符串');
  }
  if (!t.goal || typeof t.goal !== 'string') {
    errors.push('goal 必填且为字符串');
  }
  if (!Array.isArray(t.context)) {
    errors.push('context 必填且为数组');
  } else {
    if (t.context.length > 0 && (t.context[0] as ContextEntry)?.type !== 'input') {
      errors.push('context[0].type 必须是 "input"');
    }
    for (let i = 1; i < t.context.length; i++) {
      const entry = t.context[i] as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') {
        errors.push(`context[${i}] 必须是对象`);
        continue;
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
// 构造
// ============================================================

export interface CreateTaskInput {
  goal: string;
  description: string;
  input?: Record<string, unknown>;
  publisher?: string;
  priority?: TaskPriority;
}

// Named export so operations.ts can import directly (avoids require() in ESM)
export function createTask(input: CreateTaskInput): Task {
  const {
    goal,
    description,
    input: inputData = {},
    publisher = 'user',
    priority = TaskPriority.NORMAL
  } = input;

  return {
    taskId: `task_${Date.now()}`,
    description: String(description),
    goal: String(goal),
    context: [
      {
        type: 'input',
        data: inputData,
        createdAt: Date.now()
      }
    ],
    priority,
    publisher: publisher || 'user',
    status: TaskStatus.PENDING,
    executor: null,
    lastExecutor: null,
    createdAt: Date.now(),
    completedAt: null,
    lastHeartbeatAt: null
  };
}

// ============================================================
// 格式化（对外展示）
// ============================================================

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '⏳ 待认领',
  [TaskStatus.RUNNING]: '⚙️ 执行中',
  [TaskStatus.COMPLETED]: '✅ 完成',
  [TaskStatus.FAILED]: '❌ 失败',
  [TaskStatus.CANCELLED]: '🚫 已取消'
};

export function getStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.HIGH]: '🔴 高',
  [TaskPriority.NORMAL]: '🟡 中',
  [TaskPriority.LOW]: '🟢 低'
};

export function formatTaskForHuman(task: Task): string {
  const lines: string[] = [
    `🎯 ${task.goal}`,
    `📋 当前：${task.description}`,
    `ID: ${task.taskId}`,
    `优先级: ${PRIORITY_LABELS[task.priority] ?? '🟡 中'}`,
    `状态: ${getStatusLabel(task.status)}`
  ];

  const stepCount = task.context.length - 1;
  if (stepCount === 0) {
    lines.push('📝 还未开始执行');
  } else {
    lines.push(`📝 已完成 ${stepCount} 步`);
  }

  if (task.executor) lines.push(`执行者: ${task.executor}`);
  if (task.lastExecutor) lines.push(`上一步: ${task.lastExecutor}`);

  return lines.join('\n');
}

export function getTaskSummary(task: Task): string {
  if (!task.context || task.context.length === 0) return '（无上下文）';

  const lastEntry = task.context[task.context.length - 1];
  if (lastEntry.type === 'input') return '（初始输入，暂无执行结果）';

  const last = lastEntry as ContextStepEntry;
  if (last.output?.summary) return last.output.summary;
  if (last.output?.files?.length) return `[文件] ${last.output.files.join(', ')}`;
  return '（无摘要）';
}
