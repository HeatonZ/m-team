/**
 * Tool parameter schemas.
 */

export const ContextOutputSchema = {
  type: 'object' as const,
  description: 'Step output payload',
  properties: {
    summary: { type: 'string', description: 'Step summary' },
    files: { type: 'array', items: { type: 'string' }, description: 'Relative file paths inside the task directory' },
  },
} as const;

export interface ContextStepOutputInterface {
  summary?: string;
  files?: string[];
  error?: string;
  [key: string]: unknown;
}

export const PublishTaskParams = {
  type: 'object' as const,
  properties: {
    goal: { type: 'string', description: 'Overall goal; only for agent_end and publisher acceptance, not for executor execution' },
    description: { type: 'string', description: 'Current step only. One step, one action.' },
    taskType: {
      type: 'string',
      description: 'Task category for coarse routing',
      enum: ['general', 'coding', 'research', 'ops', 'data', 'design', 'content'],
    },
    publisher: { type: 'string', description: 'Publisher; defaults to current toolContext.agentId if omitted' },
    priority: { type: 'string', description: 'Priority: high / normal / low', enum: ['high', 'normal', 'low'] },
  },
  required: ['goal', 'description', 'taskType'] as const,
} as const;

export interface PublishTaskParamsInterface {
  goal: string;
  description: string;
  taskType: 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content';
  publisher?: string;
  priority?: 'high' | 'normal' | 'low';
}

export const ClaimTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    agentId: { type: 'string', description: 'Executor agentId' },
  },
  required: ['taskId', 'agentId'] as const,
} as const;

export interface ClaimTaskParamsInterface {
  taskId: string;
  agentId: string;
}

export const CancelTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    publisher: { type: 'string', description: 'Publisher; must match the original publisher' },
    reason: { type: 'string', description: 'Cancellation reason' },
  },
  required: ['taskId', 'publisher'] as const,
} as const;

export const CloseTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    publisher: { type: 'string', description: 'Publisher; must match the original publisher' },
  },
  required: ['taskId', 'publisher'] as const,
} as const;

export const RejectTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    reason: { type: 'string', description: 'Rejection reason' },
    description: { type: 'string', description: 'Next current-step description after rejection' },
  },
  required: ['taskId', 'reason', 'description'] as const,
} as const;

export const NextTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    agentId: { type: 'string', description: 'Current executor agentId' },
    contextStep: { type: 'string', description: 'Current step description' },
    contextOutput: ContextOutputSchema,
    description: { type: 'string', description: 'Next current-step description' },
    nextTaskType: {
      type: 'string',
      description: 'Optional next taskType for routing the next step',
      enum: ['general', 'coding', 'research', 'ops', 'data', 'design', 'content'],
    },
  },
  required: ['taskId', 'agentId', 'contextStep', 'description'] as const,
} as const;

export const RelinquishTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    executorId: { type: 'string', description: 'Current executor agentId' },
    reason: { type: 'string', description: 'Optional relinquish reason' },
  },
  required: ['taskId', 'executorId'] as const,
} as const;

export const GetPendingParams = {
  type: 'object' as const,
  properties: {
    agentId: { type: 'string', description: 'agentId' },
  },
  required: ['agentId'] as const,
} as const;

export const GetAgentActiveParams = {
  type: 'object' as const,
  properties: {
    agentId: { type: 'string', description: 'agentId' },
  },
  required: ['agentId'] as const,
} as const;

export const GetTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
  },
  required: ['taskId'] as const,
} as const;

export const GetAllTasksParams = {
  type: 'object' as const,
  properties: {
    status: {
      type: 'string' as const,
      description: 'Filter by status: pending / running / completed / failed / cancelled / closed',
    },
  },
  required: [] as const,
} as const;

export interface CancelTaskParamsInterface {
  taskId: string;
  publisher: string;
  reason?: string;
}

export interface CloseTaskParamsInterface {
  taskId: string;
  publisher: string;
}

export interface RejectTaskParamsInterface {
  taskId: string;
  reason: string;
  description: string;
}

export interface NextTaskParamsInterface {
  taskId: string;
  agentId: string;
  contextStep: string;
  contextOutput?: ContextStepOutputInterface;
  description: string;
  nextTaskType?: 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content';
}

export interface RelinquishTaskParamsInterface {
  taskId: string;
  executorId: string;
  reason?: string;
}

export interface GetPendingParamsInterface {
  agentId: string;
}

export interface GetAgentActiveParamsInterface {
  agentId: string;
}

export interface GetTaskParamsInterface {
  taskId: string;
}

export interface GetAllTasksParamsInterface {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'closed';
}
