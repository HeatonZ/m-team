/**
 * M-Team Task Schema — 固定任务格式规范
 *
 * 任务结构是固定的，不可配置。
 * 可配置的只有路径（workspaceRoot、queueDir）。
 */
export declare const TaskStatus: {
    readonly PENDING: "pending";
    readonly CLAIMED: "claimed";
    readonly RUNNING: "running";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
};
export type TaskStatusValue = typeof TaskStatus[keyof typeof TaskStatus];
export declare const CapabilityAgent: {
    readonly captain: "captain";
    readonly maker: "maker";
    readonly scholar: "scholar";
    readonly general: any;
};
export type CapabilityLabel = keyof typeof CapabilityAgent;
export declare const TaskPriority: {
    readonly HIGH: "high";
    readonly NORMAL: "normal";
    readonly LOW: "low";
};
export type TaskPriorityValue = typeof TaskPriority[keyof typeof TaskPriority];
export declare const VALID_CAPABILITIES: readonly ["captain", "maker", "scholar", "general"];
export declare const VALID_PRIORITIES: readonly ["high", "normal", "low"];
export declare function setWorkspaceRoot(rootPath: string): void;
export declare function getWorkspaceRoot(): string;
export declare function getTaskWorkspace(taskId: string): string;
export declare function ensureTaskWorkspace(taskId: string): string;
/**
 * 标准任务结构（固定格式，不可修改）
 */
export interface Task {
    taskId: string;
    description: string;
    input: Record<string, unknown>;
    initiator: string;
    status: TaskStatusValue;
    owner: string | null;
    createdAt: number;
    claimedAt: number | null;
    completedAt: number | null;
    lastHeartbeatAt: number | null;
    summary: string | null;
    result: Record<string, unknown> | null;
    priority: TaskPriorityValue;
}
/**
 * 验证任务对象是否符合固定格式
 */
export declare function validateTask(task: unknown): {
    valid: boolean;
    errors: string[];
};
/**
 * 创建标准任务（工厂方法）
 */
export declare function createTask({ description, input, initiator, priority }: {
    description: string;
    input?: Record<string, unknown>;
    initiator?: string;
    priority?: TaskPriorityValue;
}): Task;
/**
 * 获取任务状态标签（人类可读）
 */
export declare function getStatusLabel(status: TaskStatusValue): string;
/**
 * 格式化任务为人类可读字符串
 */
export declare function formatTaskForHuman(task: Task): string;
/**
 * 获取任务的标准摘要（用于传递给下一个节点）
 */
export declare function getTaskSummary(task: Task): string;
//# sourceMappingURL=task.d.ts.map