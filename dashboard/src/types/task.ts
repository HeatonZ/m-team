export type TaskStatus = 'pending' | 'running' | 'completed' | 'closed' | 'failed' | 'cancelled';
export type TaskPriority = 'high' | 'normal' | 'low';
export type TaskPhase = 'ready' | 'executing' | 'handoff' | 'reworking' | 'finalizing' | 'done';

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

export interface TaskLifecycle {
  phase: TaskPhase;
  handoffCount: number;
  reworkCount: number;
  lastDecision?: 'retain' | 'relay' | 'complete' | 'fail';
  lastDecisionAt?: number;
  loopGuard: {
    samePhaseCount: number;
    sameDescriptionCount: number;
    noProgressCount: number;
    lastDescriptionFingerprint?: string;
    lastContextFingerprint?: string;
    lastProgressAt?: number;
  };
}

export interface Task {
  taskId: string;
  taskType?: 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content';
  goal: string;
  description: string;
  context: ContextEntry[];
  lifecycle: TaskLifecycle;
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

export const PHASE_LABELS: Record<TaskPhase, string> = {
  ready: '待接手',
  executing: '执行中',
  handoff: '等待交接',
  reworking: '返工中',
  finalizing: '收口中',
  done: '已完成',
};

export const HISTORY_STATUSES: TaskStatus[] = ['completed', 'closed', 'failed', 'cancelled'];
