/**
 * M-Team task pool write operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  openDb,
  getDb,
  closeDb,
  isDbOpen,
  getTaskRow,
  updateTaskRow,
  insertTask,
  writeTaskLog,
} from './db';
import {
  TaskStatus,
  TaskPriority,
  VALID_PRIORITIES,
  VALID_TASK_TYPES,
  TASK_STATUSES,
  type Task,
  type TaskPatch,
  type AcceptanceSnapshot,
  type ContextStepEntry,
  type ContextStepOutput,
  createTask,
  normalizeTask,
} from '../schema/task';
import { canAgentClaimTask } from './claim-routing.js';
import { TASK_CONTRACT_LIMITS } from '../task-contract.js';

let WORKSPACE_ROOT = '/mnt/d/code/m-team';
export let DB_PATH: string | null = null;

const STEP_MAX_LENGTH = TASK_CONTRACT_LIMITS.descriptionMaxLength;
const GOAL_MAX_LENGTH = TASK_CONTRACT_LIMITS.goalMaxLength;
const SUMMARY_MAX_LENGTH = TASK_CONTRACT_LIMITS.summaryMaxLength;
const ISSUE_MAX_LENGTH = TASK_CONTRACT_LIMITS.issueMaxLength;
const FILE_PATH_MAX_LENGTH = TASK_CONTRACT_LIMITS.filePathMaxLength;
const MAX_FILES = TASK_CONTRACT_LIMITS.maxFiles;
const MAX_ISSUES = TASK_CONTRACT_LIMITS.maxIssues;
const MAX_CONTEXT_STEPS = TASK_CONTRACT_LIMITS.maxContextSteps;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim();
}

function sanitizeStep(raw: string | undefined, fallback: string): string {
  const normalized = normalizeText(String(raw ?? ''));
  if (!normalized) return clipText(normalizeText(fallback), STEP_MAX_LENGTH);
  return clipText(normalized, STEP_MAX_LENGTH);
}

function sanitizeGoal(raw: string): string {
  const normalized = normalizeText(raw);
  if (!normalized) return 'Complete the requested task';
  return clipText(normalized, GOAL_MAX_LENGTH);
}

function sanitizePublisher(raw: string): string {
  const normalized = normalizeText(raw);
  if (!normalized) return 'user';
  return clipText(normalized, 80);
}

function uniqStrings(items: string[], maxItems: number, maxLength: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = clipText(normalizeText(item), maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeContextOutput(output: ContextStepOutput | undefined): ContextStepOutput {
  const raw = output ?? {};

  const summary = typeof raw.summary === 'string'
    ? clipText(normalizeText(raw.summary), SUMMARY_MAX_LENGTH)
    : undefined;

  const files = Array.isArray(raw.files)
    ? uniqStrings(raw.files.filter((item): item is string => typeof item === 'string'), MAX_FILES, FILE_PATH_MAX_LENGTH)
    : [];

  const unresolvedIssues = Array.isArray(raw.unresolvedIssues)
    ? uniqStrings(raw.unresolvedIssues.filter((item): item is string => typeof item === 'string'), MAX_ISSUES, ISSUE_MAX_LENGTH)
    : [];

  const error = typeof raw.error === 'string'
    ? clipText(normalizeText(raw.error), ISSUE_MAX_LENGTH)
    : undefined;

  return {
    ...(summary ? { summary } : {}),
    ...(files.length ? { files } : {}),
    ...(unresolvedIssues.length ? { unresolvedIssues } : {}),
    ...(error ? { error } : {}),
  };
}

function normalizePathLike(input: string): string {
  return input
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
}

function isAbsolutePathLike(input: string): boolean {
  return input.startsWith('/') || /^[a-zA-Z]:\//.test(input);
}

function collectAcceptanceFiles(taskId: string, context: ContextStepEntry[]): string[] {
  const taskDir = path.join(WORKSPACE_ROOT, 'tasks', taskId);
  const seen = new Set<string>();
  const files: string[] = [];

  for (const entry of context) {
    for (const rawFile of entry.output?.files ?? []) {
      const normalized = normalizePathLike(rawFile);
      if (!normalized) continue;
      const resolved = isAbsolutePathLike(normalized)
        ? normalized
        : normalizePathLike(path.join(taskDir, normalized));
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      files.push(resolved);
      if (files.length >= MAX_FILES) return files;
    }
  }

  return files;
}

function buildAcceptanceSnapshot(task: Task, context: ContextStepEntry[]): AcceptanceSnapshot {
  const taskDir = normalizePathLike(path.join(WORKSPACE_ROOT, 'tasks', task.taskId));
  const latest = context.length ? context[context.length - 1] : null;
  const summary = latest?.output?.summary
    ? clipText(normalizeText(latest.output.summary), SUMMARY_MAX_LENGTH)
    : undefined;
  const files = collectAcceptanceFiles(task.taskId, context);

  return {
    taskDir,
    ...(summary ? { summary } : {}),
    ...(files.length ? { files } : {}),
    updatedAt: Date.now(),
    source: 'agent_end',
  };
}

export function setWorkspaceRoot(root: string): void {
  WORKSPACE_ROOT = root;
  DB_PATH = path.join(root, 'queue', 'm-team.db');
  if (isDbOpen()) closeDb();
}

function getTasksDir(): string {
  return path.join(WORKSPACE_ROOT, 'tasks');
}

function getTaskPath(taskId: string): string {
  return path.join(getTasksDir(), taskId, 'task.json');
}

function syncTaskJson(task: Task): void {
  const p = getTaskPath(task.taskId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(normalizeTask(task), null, 2), 'utf8');
}

interface TaskPersistenceSnapshot {
  taskId: string | null;
  status: string | null;
  description: string | null;
  taskType: string | null;
  acceptance: string | null;
  updatedAt: number | null;
  contextLength: number | null;
  lastExecutor: string | null;
  executor: string | null;
  completedAt: number | null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildTaskSnapshot(task: Task): TaskPersistenceSnapshot {
  return {
    taskId: task.taskId ?? null,
    status: task.status ?? null,
    description: task.description ?? null,
    taskType: task.taskType ?? null,
    acceptance: task.acceptance ? JSON.stringify(task.acceptance) : null,
    updatedAt: toNullableNumber(task.updatedAt),
    contextLength: Array.isArray(task.context) ? task.context.length : 0,
    lastExecutor: task.lastExecutor ?? null,
    executor: task.executor ?? null,
    completedAt: task.completedAt ?? null,
  };
}

function buildTaskSnapshotFromJson(raw: unknown): TaskPersistenceSnapshot {
  if (!raw || typeof raw !== 'object') {
    return {
      taskId: null,
      status: null,
      description: null,
      taskType: null,
      acceptance: null,
      updatedAt: null,
      contextLength: null,
      lastExecutor: null,
      executor: null,
      completedAt: null,
    };
  }

  const record = raw as Record<string, unknown>;
  const contextValue = record.context;
  return {
    taskId: toNullableString(record.taskId),
    status: toNullableString(record.status),
    description: toNullableString(record.description),
    taskType: toNullableString(record.taskType),
    acceptance: record.acceptance ? JSON.stringify(record.acceptance) : null,
    updatedAt: toNullableNumber(record.updatedAt),
    contextLength: Array.isArray(contextValue) ? contextValue.length : null,
    lastExecutor: toNullableString(record.lastExecutor),
    executor: toNullableString(record.executor),
    completedAt: record.completedAt === null ? null : toNullableNumber(record.completedAt),
  };
}

function compareTaskSnapshots(dbSnapshot: TaskPersistenceSnapshot, jsonSnapshot: TaskPersistenceSnapshot): Array<{
  field: keyof TaskPersistenceSnapshot;
  db: unknown;
  taskJson: unknown;
}> {
  const fields: Array<keyof TaskPersistenceSnapshot> = [
    'taskId',
    'status',
    'description',
    'taskType',
    'acceptance',
    'updatedAt',
    'contextLength',
    'lastExecutor',
    'executor',
    'completedAt',
  ];

  const mismatches: Array<{ field: keyof TaskPersistenceSnapshot; db: unknown; taskJson: unknown }> = [];
  for (const field of fields) {
    if (dbSnapshot[field] !== jsonSnapshot[field]) {
      mismatches.push({
        field,
        db: dbSnapshot[field],
        taskJson: jsonSnapshot[field],
      });
    }
  }
  return mismatches;
}

function verifyTaskDbJsonConsistency(task: Task, surface: string, strict: boolean): void {
  verifyTaskDbJsonConsistencyWithOptions(task, surface, {
    strict,
    allowTaskJsonMissing: false,
  });
}

function verifyTaskDbJsonConsistencyWithOptions(task: Task, surface: string, options: {
  strict: boolean;
  allowTaskJsonMissing?: boolean;
}): void {
  const taskPath = getTaskPath(task.taskId);
  const dbSnapshot = buildTaskSnapshot(task);
  let jsonSnapshot: TaskPersistenceSnapshot;
  let parseError: string | null = null;

  try {
    const rawText = fs.readFileSync(taskPath, 'utf8');
    const parsed = JSON.parse(rawText) as unknown;
    jsonSnapshot = buildTaskSnapshotFromJson(parsed);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    jsonSnapshot = {
      taskId: null,
      status: null,
      description: null,
      taskType: null,
      acceptance: null,
      updatedAt: null,
      contextLength: null,
      lastExecutor: null,
      executor: null,
      completedAt: null,
    };
  }

  if (parseError && options.allowTaskJsonMissing && /ENOENT/i.test(parseError)) {
    return;
  }

  const mismatches = compareTaskSnapshots(dbSnapshot, jsonSnapshot);
  if (!parseError && mismatches.length === 0) return;

  const detail = {
    surface,
    taskPath,
    parseError,
    mismatches,
    dbSnapshot,
    taskJsonSnapshot: jsonSnapshot,
  };

  writeTaskLog({
    taskId: task.taskId,
    action: 'consistency_guard',
    params: {
      surface,
      strict: options.strict,
      allowTaskJsonMissing: options.allowTaskJsonMissing === true,
    },
    result: detail as unknown as Record<string, unknown>,
    error: 'TASK_DB_JSON_INCONSISTENT',
  });

  const summary = parseError
    ? `parseError=${parseError}`
    : mismatches.map((item) => `${item.field}(db=${String(item.db)} taskJson=${String(item.taskJson)})`).join(', ');
  console.error(`[m-team-pool] consistency mismatch task=${task.taskId} surface=${surface} ${summary}`);

  if (options.strict) {
    throw new Error(`TASK_DB_JSON_INCONSISTENT: ${summary}`);
  }
}

function init(): void {
  if (!DB_PATH) return;
  fs.mkdirSync(getTasksDir(), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  openDb(DB_PATH);
}

function appendContext(task: Task, executorId: string | null, contextEntry: ContextStepInput | null): ContextStepEntry[] {
  const current = task.context ?? [];
  if (!contextEntry) return current.slice(-MAX_CONTEXT_STEPS);

  return [
    ...current,
    {
      type: 'step',
      executor: executorId || task.executor || 'unknown',
      step: sanitizeStep(contextEntry.step, task.description),
      output: sanitizeContextOutput(contextEntry.output),
      completedAt: Date.now(),
    },
  ].slice(-MAX_CONTEXT_STEPS);
}

function setTaskState(
  taskId: string,
  patch: TaskPatch,
): Task {
  const current = getTaskRow(taskId);
  if (current) {
    // Pre-check is advisory only for missing task.json (legacy/migrated tasks).
    // Real divergence still fails fast.
    verifyTaskDbJsonConsistencyWithOptions(normalizeTask(current), 'setTaskState:pre', {
      strict: true,
      allowTaskJsonMissing: true,
    });
  }
  updateTaskRow(taskId, patch);
  const updated = normalizeTask(getTaskRow(taskId)!);
  syncTaskJson(updated);
  verifyTaskDbJsonConsistency(updated, 'setTaskState', true);
  return updated;
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === TaskStatus.FAILED
    || status === TaskStatus.CANCELLED
    || status === TaskStatus.CLOSED;
}

// ============================================================
// Write operations
// ============================================================

export function publishTask(input: {
  taskType?: string;
  description: string;
  goal: string;
  publisher?: string;
  priority?: string;
}): string {
  init();

  const { taskType, description, goal, publisher, priority } = input;
  const task = createTask({
    taskType: taskType as import('../schema/task').TaskType | undefined,
    description: sanitizeStep(description, 'Execute current step'),
    goal: sanitizeGoal(goal),
    publisher,
    priority: priority as TaskPriority | undefined,
  });

  const db = getDb();
  db.transaction(() => {
    insertTask(task);
    syncTaskJson(task);
  })();
  verifyTaskDbJsonConsistency(task, 'publishTask', false);

  console.log(`[m-team-pool] task published: ${task.taskId} - ${task.description}`);
  return task.taskId;
}

export interface ClaimResult {
  success: boolean;
  taskId: string;
  task?: Task;
  reason?: string;
}

export function claimTask(taskId: string, agentId: string): ClaimResult {
  init();
  const db = getDb();

  const result = db.transaction(() => {
    const task = getTaskRow(taskId);
    if (!task) return { success: false, taskId, reason: 'TASK_NOT_FOUND' };
    if (task.status !== TaskStatus.PENDING) return { success: false, taskId, reason: 'NOT_PENDING' };
    const eligibility = canAgentClaimTask(task, agentId);
    if (!eligibility.ok) return { success: false, taskId, reason: eligibility.reason };

    const existingActive = db.prepare(
      'SELECT task_id FROM tasks WHERE executor = ? AND status = ?'
    ).get(agentId, TaskStatus.RUNNING);
    if (existingActive) return { success: false, taskId, reason: 'ALREADY_HAS_ACTIVE_TASK' };

    const updated = db.prepare(
      'UPDATE tasks SET status = ?, executor = ?, last_executor = ?, updated_at = ? WHERE task_id = ? AND status = ?'
    ).run(
      TaskStatus.RUNNING,
      agentId,
      task.executor !== null ? task.executor : task.lastExecutor,
      Date.now(),
      taskId,
      TaskStatus.PENDING,
    );

    if (updated.changes === 0) {
      return { success: false, taskId, reason: 'ALREADY_CLAIMED' };
    }

    const updatedTask = normalizeTask(getTaskRow(taskId)!);
    syncTaskJson(updatedTask);
    verifyTaskDbJsonConsistency(updatedTask, 'claimTask', false);
    console.log(`[m-team-pool] ${agentId} claimed task ${taskId}`);
    return { success: true, taskId, task: updatedTask };
  })();

  return result as ClaimResult;
}

export interface ContextStepInput {
  step: string;
  output?: ContextStepOutput;
}

export function updateTask(
  taskId: string,
  status: string | null,
  contextEntry: ContextStepInput | null,
  description: string | null,
  updatedAt: number | null,
  executorId: string | null,
): Task | null {
  init();
  const task = getTaskRow(taskId);
  if (!task) return null;

  if (status && isTerminalStatus(task.status) && status !== task.status) {
    throw new Error(`TASK_TERMINAL_${task.status.toUpperCase()}_IMMUTABLE`);
  }

  const context = appendContext(task, executorId, contextEntry);

  return setTaskState(taskId, {
    ...(status ? { status: status as Task['status'] } : {}),
    ...(description ? { description: sanitizeStep(description, task.description) } : {}),
    ...((status as TaskStatus | null) === TaskStatus.PENDING ? { acceptance: null } : {}),
    ...(updatedAt ? { updatedAt } : { updatedAt: Date.now() }),
    context: JSON.stringify(context),
  });
}

export interface CancelResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function cancelTask(taskId: string, _publisher?: string, reason?: string): CancelResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CLOSED || task.status === TaskStatus.CANCELLED) {
    return { success: false, reason: 'TASK_ALREADY_TERMINAL' };
  }

  const context = reason
    ? appendContext(task, task.executor, { step: 'Task cancelled', output: { summary: reason } })
    : task.context;

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.CANCELLED,
      executor: null,
      acceptance: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export interface RelinquishResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function relinquishTask(taskId: string, executorId?: string, reason?: string): RelinquishResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (executorId && task.executor && executorId !== task.executor) return { success: false, reason: 'NOT_CURRENT_EXECUTOR' };

  const context = reason
    ? appendContext(task, task.executor, { step: 'Task relinquished', output: { summary: reason, unresolvedIssues: [reason] } })
    : task.context;

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: task.executor,
      acceptance: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export interface NextResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function nextTask(
  taskId: string,
  executorId: string,
  contextEntry: ContextStepInput | null,
  description?: string,
  nextTaskType?: Task['taskType'],
): NextResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status === TaskStatus.CANCELLED) return { success: false, reason: 'TASK_CANCELLED' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };
  if (task.executor !== executorId) return { success: false, reason: 'NOT_CURRENT_EXECUTOR' };

  const nextDescription = sanitizeStep(description?.trim() || task.description, task.description);
  const context = appendContext(task, executorId, contextEntry);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      lastExecutor: executorId,
      description: nextDescription,
      ...(nextTaskType ? { taskType: nextTaskType } : {}),
      acceptance: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export interface CompleteResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export interface RejectResult {
  success: boolean;
  task?: Task | null;
  reason?: string;
}

export function rejectTask(
  taskId: string,
  publisher: string,
  reason: string,
  description?: string | null,
): RejectResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.COMPLETED) {
    return { success: false, reason: `TASK_NOT_COMPLETED_${task.status}` };
  }
  if (task.publisher !== publisher) {
    return { success: false, reason: 'PUBLISHER_MISMATCH' };
  }

  const context = appendContext(task, null, {
    step: reason,
    output: {},
  });

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.PENDING,
      executor: null,
      description: sanitizeStep(description?.trim() || task.description, task.description),
      acceptance: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export function completeTask(
  taskId: string,
  contextEntry: ContextStepInput,
): CompleteResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING) return { success: false, reason: `TASK_NOT_RUNNING_${task.status}` };

  const context = appendContext(task, task.executor, contextEntry);
  const acceptance = buildAcceptanceSnapshot(task, context);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now(),
      executor: null,
      lastExecutor: task.executor ?? task.lastExecutor,
      acceptance: JSON.stringify(acceptance),
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export interface FailResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function failTask(
  taskId: string,
  reason: string,
  contextEntry: ContextStepInput,
): FailResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
    return { success: false, reason: `TASK_NOT_MUTABLE_${task.status}` };
  }

  const context = appendContext(task, task.executor, contextEntry);

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.FAILED,
      completedAt: Date.now(),
      executor: null,
      lastExecutor: task.executor ?? task.lastExecutor,
      acceptance: null,
      updatedAt: Date.now(),
      context: JSON.stringify(context),
    }),
  };
}

export interface CloseResult {
  success: boolean;
  task?: Task;
  reason?: string;
}

export function closeTask(taskId: string, publisher?: string): CloseResult {
  init();
  const task = getTaskRow(taskId);
  if (!task) return { success: false, reason: 'TASK_NOT_FOUND' };
  if (task.status !== TaskStatus.COMPLETED) return { success: false, reason: `TASK_NOT_COMPLETED_${task.status}` };
  if (publisher && task.publisher !== publisher) return { success: false, reason: 'PUBLISHER_MISMATCH' };

  return {
    success: true,
    task: setTaskState(taskId, {
      status: TaskStatus.CLOSED,
      updatedAt: Date.now(),
    }),
  };
}

export interface EditTaskInput {
  goal?: string;
  description?: string;
  status?: Task['status'];
  taskType?: Task['taskType'];
  priority?: Task['priority'];
  publisher?: string;
  executor?: string | null;
  lastExecutor?: string | null;
}

export function editTask(taskId: string, patch: EditTaskInput): Task | null {
  init();
  const task = getTaskRow(taskId);
  if (!task) return null;

  const patchData: TaskPatch = {};

  if (typeof patch.goal === 'string') {
    patchData.goal = sanitizeGoal(patch.goal);
  }

  if (typeof patch.description === 'string') {
    patchData.description = sanitizeStep(patch.description, task.description);
  }

  if (typeof patch.taskType === 'string') {
    if (!VALID_TASK_TYPES.includes(patch.taskType)) {
      throw new Error(`INVALID_TASK_TYPE_${patch.taskType}`);
    }
    patchData.taskType = patch.taskType;
  }

  if (typeof patch.priority === 'string') {
    if (!VALID_PRIORITIES.includes(patch.priority)) {
      throw new Error(`INVALID_PRIORITY_${patch.priority}`);
    }
    patchData.priority = patch.priority;
  }

  if (typeof patch.publisher === 'string') {
    patchData.publisher = sanitizePublisher(patch.publisher);
  }

  if (patch.executor !== undefined) {
    if (patch.executor === null) patchData.executor = null;
    else patchData.executor = sanitizePublisher(patch.executor);
  }

  if (patch.lastExecutor !== undefined) {
    if (patch.lastExecutor === null) patchData.lastExecutor = null;
    else patchData.lastExecutor = sanitizePublisher(patch.lastExecutor);
  }

  if (typeof patch.status === 'string') {
    if (!TASK_STATUSES.includes(patch.status)) {
      throw new Error(`INVALID_STATUS_${patch.status}`);
    }
    patchData.status = patch.status;

    switch (patch.status) {
      case TaskStatus.PENDING:
        if (patch.executor === undefined) patchData.executor = null;
        patchData.completedAt = null;
        patchData.acceptance = null;
        break;
      case TaskStatus.RUNNING:
        patchData.completedAt = null;
        patchData.acceptance = null;
        break;
      case TaskStatus.COMPLETED: {
        patchData.completedAt = task.completedAt ?? Date.now();
        if (patch.executor === undefined) patchData.executor = null;
        if (!task.acceptance) {
          patchData.acceptance = JSON.stringify(buildAcceptanceSnapshot(task, task.context ?? []));
        }
        break;
      }
      case TaskStatus.CLOSED:
        patchData.completedAt = task.completedAt ?? Date.now();
        if (patch.executor === undefined) patchData.executor = null;
        break;
      case TaskStatus.FAILED:
      case TaskStatus.CANCELLED:
        patchData.completedAt = task.completedAt ?? Date.now();
        if (patch.executor === undefined) patchData.executor = null;
        patchData.acceptance = null;
        break;
    }
  }

  if (Object.keys(patchData).length === 0) {
    return normalizeTask(task);
  }

  return setTaskState(taskId, {
    ...patchData,
    updatedAt: Date.now(),
  });
}
