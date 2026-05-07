/**
 * 工具参数 Schema — 单一来源
 */

// ─── 通用部件 ───────────────────────────────────────────────────────────────

/** contextOutput — 步骤输出（complete/relay/update 共用） */
export const ContextOutputSchema = {
  type: 'object' as const,
  description: '步骤输出',
  properties: {
    summary: { type: 'string', description: '步骤摘要' },
    files: { type: 'array', items: { type: 'string' }, description: '任务文件夹内的相对路径' },
  },
} as const;

// ─── 各工具参数 Schema ─────────────────────────────────────────────────────

export const PublishTaskParams = {
  type: 'object' as const,
  properties: {
    goal: { type: 'string', description: '任务目标（executor 凭此判断任务是否适合自己，必须有区分度，不能只是标题）' },
    description: { type: 'string', description: '当前这一步做什么（每次只写一步，relay 时由上一个 executor 填写下一步）' },
    input: { type: 'object', description: '初始输入数据', additionalProperties: true },
    publisher: { type: 'string', description: '发布者，默认 "user"' },
    priority: { type: 'string', description: '优先级 high/normal/low，默认 normal', enum: ['high', 'normal', 'low'] },
  },
  required: ['goal', 'description'] as const,
} as const;

export const ClaimTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    agentId: { type: 'string', description: '认领者 agentId' },
  },
  required: ['taskId', 'agentId'] as const,
} as const;

export const CancelTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
    reason: { type: 'string', description: '取消原因' },
  },
  required: ['taskId', 'publisher'] as const,
} as const;

export const CloseTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    publisher: { type: 'string', description: '发布者（需与创建时 publisher 一致）' },
  },
  required: ['taskId', 'publisher'] as const,
} as const;

export const CompleteTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    contextStep: { type: 'string', description: '当前步骤描述（必填，必须说明这一步做了什么）' },
    contextOutput: ContextOutputSchema,
  },
  required: ['taskId', 'contextStep'] as const,
} as const;

export const RejectTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    reason: { type: 'string', description: '驳回原因' },
  },
  required: ['taskId', 'reason'] as const,
} as const;

export const RelayTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    agentId: { type: 'string', description: '执行者 agentId' },
    contextStep: { type: 'string', description: '当前步骤描述' },
    contextOutput: ContextOutputSchema,
    description: { type: 'string', description: 'relay 后任务的 description（下一棒看到的内容）' },
  },
  required: ['taskId', 'agentId', 'contextStep', 'description'] as const,
} as const;

export const RelinquishTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    executorId: { type: 'string', description: '执行者 agentId' },
    reason: { type: 'string', description: '放弃原因（会在 context step 中记录）' },
  },
  required: ['taskId', 'executorId'] as const,
} as const;

export const UpdateTaskParams = {
  type: 'object' as const,
  properties: {
    taskId: { type: 'string', description: '任务ID' },
    agentId: { type: 'string', description: '执行者 agentId（追加 context 时必填）' },
    status: { type: 'string', description: '状态', enum: ['running', 'completed', 'failed', 'pending', 'cancelled'] },
    contextStep: { type: 'string', description: '当前步骤描述' },
    contextOutput: ContextOutputSchema,
    description: { type: 'string', description: '更新当前步骤描述（下一步做什么）' },
  },
  required: ['taskId'] as const,
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
    taskId: { type: 'string', description: '任务ID' },
  },
  required: ['taskId'] as const,
} as const;

export const GetAllTasksParams = {
  type: 'object' as const,
  properties: {} as const,
  required: [] as const,
} as const;
