/**
 * M-Team Queue — 去中心化任务池
 *
 * 所有路径基于 workspaceRoot 计算
 */
import { Task } from '../schema/task.js';
/**
 * 设置 workspaceRoot（queue 和 schema 必须同步）
 */
export declare function setWorkspaceRoot(root: string): void;
/**
 * 发布新任务
 */
export declare function publishTask({ description, input, requiredCapability, initiator, priority }: {
    description: string;
    input?: Record<string, unknown>;
    requiredCapability?: string;
    initiator?: string;
    priority?: string;
}): string;
/**
 * 认领任务（原子操作，防止并发竞态）
 * 核心：用 wx 锁文件保证只有一个 agent 能进入 critical section
 */
export declare function claimTask(taskId: string, agentId: string): boolean;
/**
 * 获取待认领任务列表
 */
export declare function getPendingTasks(agentId?: string | null): Task[];
/**
 * 获取 agent 当前进行中的任务（claimed 或 running）
 */
export declare function getAgentActiveTask(agentId: string): Task | null;
/**
 * 更新任务状态
 */
export declare function updateTask(taskId: string, status?: string, result?: Record<string, unknown> | null, summary?: string | null, description?: string | null, lastHeartbeatAt?: number | null): Task | null;
/**
 * 获取任务详情
 */
export declare function getTask(taskId: string): Task | null;
/**
 * 获取所有任务
 */
export declare function getAllTasks(): Task[];
/**
 * 获取某 agent 的任务
 */
export declare function getTasksByOwner(agentId: string): Task[];
//# sourceMappingURL=index.d.ts.map