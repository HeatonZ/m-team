/**
 * M-Team Queue — 去中心化任务池
 *
 * 所有路径基于 workspaceRoot 计算
 */
import fs from 'fs';
import path from 'path';
import { TaskStatus, createTask, getTaskWorkspace, ensureTaskWorkspace, setWorkspaceRoot as setSchemaWorkspaceRoot } from '../schema/task.js';
// workspaceRoot 可动态设置
let WORKSPACE_ROOT = '/mnt/d/code/m-team';
/**
 * 设置 workspaceRoot（queue 和 schema 必须同步）
 */
export function setWorkspaceRoot(root) {
    WORKSPACE_ROOT = root;
    // 同步更新 schema 的路径，确保 publishTask/claimTask 等操作一致性
    setSchemaWorkspaceRoot(path.join(root, 'tasks'));
}
/**
 * 获取 tasks 目录
 */
function getTasksDir() {
    return path.join(WORKSPACE_ROOT, 'tasks');
}
/**
 * 获取 queue 目录
 */
function getQueueDir() {
    return path.join(WORKSPACE_ROOT, 'queue');
}
/**
 * 获取任务索引文件路径
 */
function getTasksIndexPath() {
    return path.join(getQueueDir(), 'tasks.json');
}
/**
 * 初始化队列目录
 */
function init() {
    fs.mkdirSync(getTasksDir(), { recursive: true });
    fs.mkdirSync(getQueueDir(), { recursive: true });
    const indexPath = getTasksIndexPath();
    if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, JSON.stringify({ tasks: [], version: 1 }, null, 2), 'utf8');
    }
}
/**
 * 发布新任务
 */
export function publishTask({ description, input = {}, requiredCapability, initiator = 'ceo', priority }) {
    init();
    const task = createTask({ description, input, initiator, priority: priority });
    const taskDir = ensureTaskWorkspace(task.taskId);
    // 写入任务文件
    const taskPath = path.join(taskDir, 'task.json');
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
    // 更新索引
    const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
    index.tasks.push(task.taskId);
    fs.writeFileSync(getTasksIndexPath(), JSON.stringify(index, null, 2), 'utf8');
    console.log(`[m-team-queue] 任务发布: ${task.taskId} - ${description}`);
    return task.taskId;
}
/**
 * 认领任务（原子操作，防止并发竞态）
 * 核心：用 wx 锁文件保证只有一个 agent 能进入 critical section
 */
export function claimTask(taskId, agentId) {
    const taskDir = getTaskWorkspace(taskId);
    const taskPath = path.join(taskDir, 'task.json');
    const lockPath = path.join(taskDir, '.lock');
    if (!fs.existsSync(taskPath))
        return false;
    // 1. 尝试原子创建锁文件（wx = 不存在才成功）
    try {
        fs.writeFileSync(lockPath, agentId, { flag: 'wx' });
    }
    catch (e) {
        if (e.code === 'EEXIST') {
            // 锁已存在，说明另一个 agent 在抢
            return false;
        }
        throw e;
    }
    // 2. 拿到锁，验证状态
    try {
        const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
        if (task.status !== TaskStatus.PENDING) {
            return false;
        }
        // 3. 更新状态
        task.status = TaskStatus.CLAIMED;
        task.owner = agentId;
        task.claimedAt = Date.now();
        fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
        console.log(`[m-team-queue] ${agentId} 认领了任务 ${taskId}`);
        return true;
    }
    finally {
        // 4. 无论如何都要删锁
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
    }
}
/**
 * 获取待认领任务列表
 */
export function getPendingTasks(agentId = null) {
    init();
    const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
    const pending = [];
    // 检查 agent 是否已有进行中的任务（一个 agent 不能同时做多个任务）
    if (agentId && getAgentActiveTask(agentId)) {
        return []; // 已有任务在执行，不再分配新任务
    }
    for (const tid of index.tasks) {
        const taskPath = path.join(getTaskWorkspace(tid), 'task.json');
        if (!fs.existsSync(taskPath))
            continue;
        const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
        if (task.status !== TaskStatus.PENDING)
            continue;
        pending.push(task);
    }
    const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
    return pending.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 1;
        const pb = PRIORITY_ORDER[b.priority] ?? 1;
        if (pa !== pb)
            return pa - pb; // high 先
        return a.createdAt - b.createdAt; // 同优先级按时间
    });
}
/**
 * 获取 agent 当前进行中的任务（claimed 或 running）
 */
export function getAgentActiveTask(agentId) {
    const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
    for (const tid of index.tasks) {
        const taskPath = path.join(getTaskWorkspace(tid), 'task.json');
        if (!fs.existsSync(taskPath))
            continue;
        const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
        if (task.owner === agentId && (task.status === TaskStatus.CLAIMED || task.status === TaskStatus.RUNNING)) {
            return task;
        }
    }
    return null;
}
/**
 * 更新任务状态
 */
export function updateTask(taskId, status, result, summary, description, lastHeartbeatAt) {
    const taskPath = path.join(getTaskWorkspace(taskId), 'task.json');
    if (!fs.existsSync(taskPath))
        return null;
    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    if (status)
        task.status = status;
    if (result)
        task.result = result;
    if (summary)
        task.summary = summary;
    if (description)
        task.description = description;
    if (lastHeartbeatAt)
        task.lastHeartbeatAt = lastHeartbeatAt;
    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        task.completedAt = Date.now();
    }
    if (status === TaskStatus.RUNNING && !task.lastHeartbeatAt) {
        task.lastHeartbeatAt = Date.now(); // running 时初始化心跳
    }
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
    console.log(`[m-team-queue] 任务 ${taskId} 状态: ${status}`);
    return task;
}
/**
 * 获取任务详情
 */
export function getTask(taskId) {
    const taskPath = path.join(getTaskWorkspace(taskId), 'task.json');
    if (!fs.existsSync(taskPath))
        return null;
    return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
}
/**
 * 获取所有任务
 */
export function getAllTasks() {
    init();
    const index = JSON.parse(fs.readFileSync(getTasksIndexPath(), 'utf8'));
    const tasks = [];
    for (const tid of index.tasks) {
        const task = getTask(tid);
        if (task)
            tasks.push(task);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
}
/**
 * 获取某 agent 的任务
 */
export function getTasksByOwner(agentId) {
    return getAllTasks().filter(t => t.owner === agentId);
}
//# sourceMappingURL=index.js.map