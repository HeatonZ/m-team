/**
 * 自动生成 — 请勿手动修改
 * 生成规则: json-schema-to-typescript
 * 源文件: src/types/tools.ts
 */

export interface PublishTaskParams {
  /**
   * 任务目标（executor 凭此判断任务是否适合自己，必须有区分度，不能只是标题）
   */
  goal: string;
  /**
   * 当前这一步做什么（每次只写一步，relay 时由上一个 executor 填写下一步）
   */
  description: string;
  /**
   * 初始输入数据
   */
  input?: {
    [k: string]: unknown;
  };
  /**
   * 发布者，默认 "user"
   */
  publisher?: string;
  /**
   * 优先级 high/normal/low，默认 normal
   */
  priority?: 'high' | 'normal' | 'low';
  [k: string]: unknown;
}


export interface ClaimTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 认领者 agentId
   */
  agentId: string;
  [k: string]: unknown;
}


export interface CancelTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 发布者（需与创建时 publisher 一致）
   */
  publisher: string;
  /**
   * 取消原因
   */
  reason?: string;
  [k: string]: unknown;
}


export interface CloseTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 发布者（需与创建时 publisher 一致）
   */
  publisher: string;
  [k: string]: unknown;
}


export interface CompleteTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 当前步骤描述（必填，必须说明这一步做了什么）
   */
  contextStep: string;
  /**
   * 步骤输出
   */
  contextOutput?: {
    /**
     * 步骤摘要
     */
    summary?: string;
    /**
     * 任务文件夹内的相对路径
     */
    files?: string[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}


export interface RejectTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 驳回原因
   */
  reason: string;
  [k: string]: unknown;
}


export interface RelayTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 执行者 agentId
   */
  agentId: string;
  /**
   * 当前步骤描述
   */
  contextStep: string;
  /**
   * 步骤输出
   */
  contextOutput?: {
    /**
     * 步骤摘要
     */
    summary?: string;
    /**
     * 任务文件夹内的相对路径
     */
    files?: string[];
    [k: string]: unknown;
  };
  /**
   * relay 后任务的 description（下一棒看到的内容）
   */
  description: string;
  [k: string]: unknown;
}


export interface RelinquishTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 执行者 agentId
   */
  executorId: string;
  /**
   * 放弃原因（会在 context step 中记录）
   */
  reason?: string;
  [k: string]: unknown;
}


export interface UpdateTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  /**
   * 执行者 agentId（追加 context 时必填）
   */
  agentId?: string;
  /**
   * 状态
   */
  status?: 'running' | 'completed' | 'failed' | 'pending' | 'cancelled';
  /**
   * 当前步骤描述
   */
  contextStep?: string;
  /**
   * 步骤输出
   */
  contextOutput?: {
    /**
     * 步骤摘要
     */
    summary?: string;
    /**
     * 任务文件夹内的相对路径
     */
    files?: string[];
    [k: string]: unknown;
  };
  /**
   * 更新当前步骤描述（下一步做什么）
   */
  description?: string;
  [k: string]: unknown;
}


export interface GetPendingParams {
  /**
   * agentId
   */
  agentId: string;
  [k: string]: unknown;
}


export interface GetAgentActiveParams {
  /**
   * agentId
   */
  agentId: string;
  [k: string]: unknown;
}


export interface GetTaskParams {
  /**
   * 任务ID
   */
  taskId: string;
  [k: string]: unknown;
}


export interface GetAllTasksParams {
  [k: string]: unknown;
}


/**
 * 步骤输出
 */
export interface ContextOutputSchema {
  /**
   * 步骤摘要
   */
  summary?: string;
  /**
   * 任务文件夹内的相对路径
   */
  files?: string[];
  [k: string]: unknown;
}
