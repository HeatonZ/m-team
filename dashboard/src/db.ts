/**
 * Dashboard DB layer
 * Wraps m-team/pool with WORKSPACE_ROOT setup.
 */

import {
  openDb,
  getDb,
  getTaskRow,
  getAllTaskRows,
  getTaskRowsByStatus,
  getTaskRowByExecutor,
  getTaskLogs,
  countTaskLogs,
  editTask,
} from 'm-team/pool';
import { TaskStatus } from 'm-team/schema/task';

import type { Task, TaskPriority } from './types/task.ts';
import { STATUS_LABELS, PRIORITY_LABELS } from './types/task.ts';

export type DashboardLogDecision = 'next' | 'complete' | 'fail';
export type DashboardLogVia = 'llm' | 'llm_fail_fast' | 'llm_repeat_guard';
export type DashboardLogLlmStatus = 'ok' | 'error';

export interface DashboardLogQuery {
  taskId?: string;
  action?: string;
  agentId?: string;
  sessionKey?: string;
  decision?: DashboardLogDecision;
  via?: DashboardLogVia;
  llmStatus?: DashboardLogLlmStatus;
  hasError?: boolean;
  keyword?: string;
}

export { TaskStatus, STATUS_LABELS, PRIORITY_LABELS };
export type { Task, TaskPriority };

let _dbPath: string | null = null;

export function setWorkspaceRoot(root: string): void {
  _dbPath = `${root}/queue/m-team.db`;
  openDb(_dbPath);
}

function ensureInit(): void {
  if (!getDb()) throw new Error('[dashboard] DB not initialized; call setWorkspaceRoot first');
}

export function getAllTasks() {
  ensureInit();
  return getAllTaskRows();
}

export function getTask(taskId: string) {
  ensureInit();
  return getTaskRow(taskId);
}

export function getPendingTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.PENDING);
}

export function getRunningTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.RUNNING);
}

export function getCompletedTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.COMPLETED);
}

export function getFailedTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.FAILED);
}

export function getCancelledTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.CANCELLED);
}

export function getClosedTasks() {
  ensureInit();
  return getTaskRowsByStatus(TaskStatus.CLOSED);
}

export function getAgentActiveTask(agentId: string) {
  ensureInit();
  return getTaskRowByExecutor(agentId);
}

export function getDashboardLogs(query: DashboardLogQuery, limit: number, offset: number) {
  ensureInit();
  const { taskId, action, ...advanced } = query;
  return getTaskLogs(taskId, action, limit, offset, advanced);
}

export function countDashboardLogs(query: DashboardLogQuery) {
  ensureInit();
  const { taskId, action, ...advanced } = query;
  return countTaskLogs(taskId, action, advanced);
}

export interface EditTaskPatch {
  goal?: string;
  description?: string;
  status?: Task['status'];
  taskType?: Task['taskType'];
  priority?: Task['priority'];
  publisher?: string;
  executor?: string | null;
  lastExecutor?: string | null;
}

export function editTaskById(taskId: string, patch: EditTaskPatch): Task | null {
  ensureInit();
  return editTask(taskId, patch);
}
