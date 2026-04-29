/**
 * Type stubs for m-team src modules (JS sources have no .d.ts)
 * These match the actual JS exports in src/
 */

/** @typedef {import('../src/schema/task.js').TaskStatus} TaskStatus */
/** @typedef {import('../src/schema/task.js').TaskPriority} TaskPriority */

// --- schema/task.js ---
export const TaskStatus: {
  PENDING: 'pending';
  RUNNING: 'running';
  COMPLETED: 'completed';
  FAILED: 'failed';
  CANCELLED: 'cancelled';
};

export const TaskPriority: {
  HIGH: 'high';
  NORMAL: 'normal';
  LOW: 'low';
};

// --- pool/index.js ---
export interface TaskContextEntry {
  type?: string;
  step?: string;
  output?: Record<string, unknown>;
  executor?: string;
}

export interface Task {
  taskId: string;
  description: string;
  goal: string;
  context: TaskContextEntry[];
  publisher: string;
  status: string;
  executor: string | null;
  lastExecutor: string | null;
  createdAt: number;
  completedAt: number | null;
  lastHeartbeatAt: number | null;
  priority: string;
}

export const pool: {
  getTask(taskId: string): Task | null;
  getAgentActiveTask(agentId: string): Task | null;
  getPendingTasks(agentId: string): Task[];
};

// --- pool/operations.js ---
export interface PublishTaskInput {
  description: string;
  goal: string;
  input?: Record<string, unknown>;
  publisher?: string;
  priority?: string;
}

export interface RelayContextInput {
  step: string;
  output: Record<string, unknown>;
}

export interface CompleteContextInput {
  step: string;
  output: Record<string, unknown>;
}

export interface OperationResult {
  success: boolean;
  error?: string;
}

export const ops: {
  publishTask(input: PublishTaskInput): string;
  claimTask(taskId: string, agentId: string): OperationResult;
  relayTask(taskId: string, agentId: string, ctx: RelayContextInput): OperationResult;
  completeTask(taskId: string, ctx: CompleteContextInput): OperationResult;
  updateTask(
    taskId: string,
    status: unknown,
    executor: unknown,
    context: unknown,
    lastHeartbeatAt: number | null
  ): { lastHeartbeatAt: number | null };
};
