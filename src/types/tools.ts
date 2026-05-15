/**
 * Tool parameter schemas.
 */

import {
  GOAL_INLINE_HINT,
  DESCRIPTION_INLINE_HINT,
  CONTEXT_OUTPUT_INLINE_HINT,
} from '../task-contract.js';
import { TASK_TYPE_INLINE_HINT } from '../task-type.js';

export const ContextOutputSchema = {
  type: 'object' as const,
  description: CONTEXT_OUTPUT_INLINE_HINT,
  properties: {
    summary: { type: 'string', description: 'Current step summary' },
    files: { type: 'array', items: { type: 'string' }, description: 'Artifact file paths' },
    unresolvedIssues: { type: 'array', items: { type: 'string' }, description: 'Blocking issues from this step' },
    error: { type: 'string', description: 'Primary blocking error for this step' },
  },
} as const;

export interface ContextStepOutputInterface {
  summary?: string;
  files?: string[];
  unresolvedIssues?: string[];
  error?: string;
}

export const PublishTaskParams = {
  type: 'object' as const,
  properties: {
    goal: { type: 'string', description: GOAL_INLINE_HINT },
    description: { type: 'string', description: DESCRIPTION_INLINE_HINT },
    taskType: {
      type: 'string',
      description: `Task category for routing. ${TASK_TYPE_INLINE_HINT}`,
      enum: ['general', 'coding', 'research', 'ops', 'data', 'design', 'content', 'ecommerce'],
    },
    publisher: { type: 'string', description: 'Publisher; defaults to current toolContext.agentId if omitted' },
    priority: { type: 'string', description: 'Priority', enum: ['high', 'normal', 'low'] },
  },
  required: ['goal', 'description', 'taskType'] as const,
} as const;

export interface PublishTaskParamsInterface {
  goal: string;
  description: string;
  taskType: 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content' | 'ecommerce';
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
    publisher: { type: 'string', description: 'Optional override; defaults to current session agent identity' },
    reason: { type: 'string', description: 'Cancellation reason' },
  },
  required: ['taskId'] as const,
} as const;

export const CloseTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    publisher: { type: 'string', description: 'Optional override; defaults to current session agent identity' },
  },
  required: ['taskId'] as const,
} as const;

export const RejectTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    publisher: { type: 'string', description: 'Optional override; defaults to current session agent identity' },
    reason: { type: 'string', description: 'Rejection reason' },
    description: { type: 'string', description: DESCRIPTION_INLINE_HINT },
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
    description: { type: 'string', description: DESCRIPTION_INLINE_HINT },
    nextTaskType: {
      type: 'string',
      description: `Optional next taskType for routing the next step. ${TASK_TYPE_INLINE_HINT}`,
      enum: ['general', 'coding', 'research', 'ops', 'data', 'design', 'content', 'ecommerce'],
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

export const GetTaskForPublisherParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: 'Task ID' },
    includeContext: { type: 'boolean', description: 'Optional debug flag. When true, include full step context.' },
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
  publisher?: string;
  reason?: string;
}

export interface CloseTaskParamsInterface {
  taskId: string;
  publisher?: string;
}

export interface RejectTaskParamsInterface {
  taskId: string;
  publisher?: string;
  reason: string;
  description: string;
}

export interface NextTaskParamsInterface {
  taskId: string;
  agentId: string;
  contextStep: string;
  contextOutput?: ContextStepOutputInterface;
  description: string;
  nextTaskType?: 'general' | 'coding' | 'research' | 'ops' | 'data' | 'design' | 'content' | 'ecommerce';
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

export interface GetTaskForPublisherParamsInterface {
  taskId: string;
  includeContext?: boolean;
}

export interface GetAllTasksParamsInterface {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'closed';
}
