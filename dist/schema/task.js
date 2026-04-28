/**
 * M-Team Task Schema — 固定任务格式规范
 *
 * 任务结构是固定的，不可配置。
 * 可配置的只有路径（workspaceRoot、queueDir）。
 */
import fs from 'fs';
import path from 'path';
// 任务状态枚举
export const TaskStatus = {
    PENDING: 'pending', // 待认领
    CLAIMED: 'claimed', // 已认领（有owner）
    RUNNING: 'running', // 执行中
    COMPLETED: 'completed', // 完成
    FAILED: 'failed' // 失败
};
// 能力标签 → agent 映射（固定映射表）
export const CapabilityAgent = {
    captain: 'captain',
    maker: 'maker',
    scholar: 'scholar',
    general: null // 任意 agent 都能认领
};
// 任务优先级枚举
export const TaskPriority = {
    HIGH: 'high',
    NORMAL: 'normal',
    LOW: 'low'
};
// 有效能力标签列表
export const VALID_CAPABILITIES = ['captain', 'maker', 'scholar', 'general'];
// 有效优先级列表
export const VALID_PRIORITIES = ['high', 'normal', 'low'];
// ============================================================
// 路径配置（可配置）
// ============================================================
let WORKSPACE_ROOT = '/mnt/d/code/m-team/workspace';
export function setWorkspaceRoot(rootPath) {
    WORKSPACE_ROOT = rootPath;
}
export function getWorkspaceRoot() {
    return WORKSPACE_ROOT;
}
export function getTaskWorkspace(taskId) {
    return path.join(WORKSPACE_ROOT, taskId);
}
export function ensureTaskWorkspace(taskId) {
    const ws = getTaskWorkspace(taskId);
    fs.mkdirSync(ws, { recursive: true });
    return ws;
}
/**
 * 验证任务对象是否符合固定格式
 */
export function validateTask(task) {
    const errors = [];
    if (!task || typeof task !== 'object') {
        return { valid: false, errors: ['task 必须是对象'] };
    }
    const t = task;
    if (!t.taskId || !String(t.taskId).startsWith('task_')) {
        errors.push('taskId 格式无效，应为 task_{timestamp}_{random}');
    }
    if (!t.description || typeof t.description !== 'string') {
        errors.push('description 必填且为字符串');
    }
    if (!Object.values(TaskStatus).includes(t.status)) {
        errors.push(`status 无效，可选值: ${Object.values(TaskStatus).join(', ')}`);
    }
    if (t.priority && !VALID_PRIORITIES.includes(t.priority)) {
        errors.push(`priority 无效，可选值: ${VALID_PRIORITIES.join(', ')}`);
    }
    return { valid: errors.length === 0, errors };
}
/**
 * 创建标准任务（工厂方法）
 */
export function createTask({ description, input = {}, initiator = 'ceo', priority = TaskPriority.NORMAL }) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return {
        taskId,
        description: String(description),
        input: input || {},
        priority,
        initiator: initiator || 'ceo',
        status: TaskStatus.PENDING,
        owner: null,
        createdAt: Date.now(),
        claimedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
        summary: null,
        result: null
    };
}
/**
 * 获取任务状态标签（人类可读）
 */
export function getStatusLabel(status) {
    const labels = {
        pending: '⏳ 待认领',
        claimed: '🔄 已认领',
        running: '⚙️ 执行中',
        completed: '✅ 完成',
        failed: '❌ 失败'
    };
    return labels[status] || status;
}
/**
 * 格式化任务为人类可读字符串
 */
export function formatTaskForHuman(task) {
    const priorityLabel = {
        high: '🔴 高',
        normal: '🟡 中',
        low: '🟢 低'
    };
    const lines = [
        `📋 ${task.description}`,
        `ID: ${task.taskId}`,
        `优先级: ${priorityLabel[task.priority] || '🟡 中'}`,
        `状态: ${getStatusLabel(task.status)}`
    ];
    if (task.owner)
        lines.push(`执行者: ${task.owner}`);
    if (task.summary)
        lines.push(`摘要: ${task.summary}`);
    return lines.join('\n');
}
/**
 * 获取任务的标准摘要（用于传递给下一个节点）
 */
export function getTaskSummary(task) {
    if (task.summary)
        return task.summary;
    if (!task.result)
        return '（无结果）';
    if (typeof task.result === 'object') {
        const keys = Object.keys(task.result);
        if (keys.length <= 3) {
            return keys.map(k => `${k}: ${JSON.stringify(task.result[k])}`).join(', ');
        }
        return `结果包含 ${keys.length} 个字段: ${keys.slice(0, 3).join(', ')}...`;
    }
    return String(task.result).substring(0, 200);
}
//# sourceMappingURL=task.js.map