/**
 * M-Team SQLite persistence.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { TaskRow, serializeTask, deserializeTask } from '../schema/db-types';
import type { Task, TaskPatch } from '../schema/task';

let _db: Database.Database | null = null;

export function openDb(dbPath: string): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('[m-team] db not opened, call openDb first');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function isDbOpen(): boolean {
  return _db !== null;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id        TEXT PRIMARY KEY,
      task_type      TEXT NOT NULL DEFAULT 'general',
      description    TEXT NOT NULL,
      goal           TEXT NOT NULL,
      context        TEXT NOT NULL DEFAULT '[]',
      acceptance     TEXT,
      priority       TEXT NOT NULL DEFAULT 'normal',
      publisher      TEXT NOT NULL DEFAULT 'user',
      status         TEXT NOT NULL DEFAULT 'pending',
      executor       TEXT,
      last_executor  TEXT,
      created_at     INTEGER NOT NULL,
      completed_at   INTEGER,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL,
      action      TEXT NOT NULL,
      session_key TEXT,
      agent_id    TEXT,
      params      TEXT,
      result      TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_logs_action ON task_logs(action);
    CREATE INDEX IF NOT EXISTS idx_task_logs_created_at ON task_logs(created_at);
  `);

  const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  const hasTaskType = columns.some(col => col.name === 'task_type');
  const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
  const hasAcceptance = columns.some(col => col.name === 'acceptance');

  if (!hasTaskType) db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'general';");
  if (!hasUpdatedAt) {
    db.exec("ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;");
    db.exec('UPDATE tasks SET updated_at = COALESCE(completed_at, created_at, 0) WHERE updated_at = 0');
  }
  if (!hasAcceptance) db.exec('ALTER TABLE tasks ADD COLUMN acceptance TEXT;');
}

export function getTaskRow(taskId: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as TaskRow | undefined;
  if (!row) return null;
  return deserializeTask(row);
}

export function getAllTaskRows(): Task[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRow[];
  return rows.map(deserializeTask);
}

export function getTaskRowsByStatus(status: string): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE status = ?
     ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END ASC,
              created_at ASC`
  ).all(status) as TaskRow[];
  return rows.map(deserializeTask);
}

export function getTaskRowByExecutor(executor: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE executor = ? AND status = ?').get(executor, 'running') as TaskRow | undefined;
  if (!row) return null;
  return deserializeTask(row);
}

export function insertTask(task: Task): void {
  const db = getDb();
  const row = serializeTask(task);
  db.prepare(`
    INSERT INTO tasks
      (task_id, task_type, description, goal, context, acceptance, priority, publisher,
       status, executor, last_executor, created_at, completed_at, updated_at)
    VALUES
      (@task_id, @task_type, @description, @goal, @context, @acceptance, @priority, @publisher,
       @status, @executor, @last_executor, @created_at, @completed_at, @updated_at)
  `).run(row);
}

export function updateTaskRow(taskId: string, patch: TaskPatch): Task | null {
  const db = getDb();

  const snakePatch: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    taskId: 'task_id',
    taskType: 'task_type',
    completedAt: 'completed_at',
    lastExecutor: 'last_executor',
    updatedAt: 'updated_at',
  };

  for (const [k, v] of Object.entries(patch)) {
    const dbKey = fieldMap[k] ?? k;
    snakePatch[dbKey] = v;
  }

  const sets = Object.keys(snakePatch).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = @task_id`).run({ ...snakePatch, task_id: taskId });
  return getTaskRow(taskId);
}

export function deleteTaskRow(taskId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
}

export interface TaskLogInput {
  taskId: string;
  action: string;
  sessionKey?: string;
  agentId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

export interface TaskLogDecisionSummary {
  decision: 'next' | 'complete' | 'fail' | null;
  via: string | null;
  reason: string | null;
  nextDescription: string | null;
  nextTaskType: string | null;
  confidence: string | null;
  llmStatus: 'ok' | 'error' | null;
  llmError: string | null;
  llmAttempts: number | null;
  hasFallback: boolean;
}

export interface TaskLog {
  id: number;
  taskId: string;
  action: string;
  sessionKey: string | null;
  agentId: string | null;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  decision: TaskLogDecisionSummary | null;
}

export interface TaskLogQuery {
  taskId?: string;
  action?: string;
  agentId?: string;
  sessionKey?: string;
  decision?: 'next' | 'complete' | 'fail';
  via?: string;
  llmStatus?: 'ok' | 'error';
  hasError?: boolean;
  keyword?: string;
}

interface RawTaskLogRow {
  id: number;
  task_id: string;
  action: string;
  session_key: string | null;
  agent_id: string | null;
  params: string | null;
  result: string | null;
  error: string | null;
  created_at: number;
}

type TaskLogCompatQuery = Omit<TaskLogQuery, 'taskId' | 'action'>;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return toRecord(parsed);
  } catch {
    return null;
  }
}

function getResultDetails(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return null;
  const details = toRecord(result.details);
  return details ?? result;
}

function extractDecisionSummary(action: string, result: Record<string, unknown> | null, error: string | null): TaskLogDecisionSummary | null {
  const details = getResultDetails(result);
  if (!details) return null;

  const decisionRaw = toStringOrNull(details.decision) ?? (['next', 'complete', 'fail'].includes(action) ? action : null);
  const decision = decisionRaw && ['next', 'complete', 'fail'].includes(decisionRaw)
    ? (decisionRaw as TaskLogDecisionSummary['decision'])
    : null;

  const llm = toRecord(details.llm);
  const fallback = details.fallback;
  const hasFallback = fallback !== undefined && fallback !== null;

  const llmStatusRaw = toStringOrNull(llm?.status);
  const llmStatus = llmStatusRaw === 'ok' || llmStatusRaw === 'error'
    ? llmStatusRaw
    : null;

  return {
    decision,
    via: toStringOrNull(details.via),
    reason: toStringOrNull(details.reason) ?? toStringOrNull(details.error) ?? error,
    nextDescription: toStringOrNull(details.nextDescription),
    nextTaskType: toStringOrNull(details.nextTaskType),
    confidence: toStringOrNull(details.confidence),
    llmStatus,
    llmError: toStringOrNull(llm?.error),
    llmAttempts: toNumberOrNull(llm?.attempts),
    hasFallback,
  };
}

function stringifyForSearch(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function toTaskLog(row: RawTaskLogRow): TaskLog {
  const params = parseJsonRecord(row.params);
  const result = parseJsonRecord(row.result);

  return {
    id: row.id,
    taskId: row.task_id,
    action: row.action,
    sessionKey: row.session_key,
    agentId: row.agent_id,
    params,
    result,
    error: row.error,
    createdAt: row.created_at,
    decision: extractDecisionSummary(row.action, result, row.error),
  };
}

function buildBaseTaskLogSelect(query: TaskLogQuery): { sql: string; args: unknown[] } {
  let sql = 'SELECT * FROM task_logs';
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (query.taskId) {
    conditions.push('task_id = ?');
    args.push(query.taskId);
  }

  if (query.action) {
    conditions.push('action = ?');
    args.push(query.action);
  }

  if (query.agentId) {
    conditions.push('agent_id = ?');
    args.push(query.agentId);
  }

  if (query.sessionKey) {
    conditions.push('session_key = ?');
    args.push(query.sessionKey);
  }

  if (query.hasError === true) {
    conditions.push("error IS NOT NULL AND trim(error) <> ''");
  } else if (query.hasError === false) {
    conditions.push("(error IS NULL OR trim(error) = '')");
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC';

  return { sql, args };
}

function matchesAdvancedQuery(log: TaskLog, query: TaskLogQuery): boolean {
  if (query.decision && log.decision?.decision !== query.decision) {
    return false;
  }

  if (query.via && (log.decision?.via ?? '') !== query.via) {
    return false;
  }

  if (query.llmStatus && (log.decision?.llmStatus ?? '') !== query.llmStatus) {
    return false;
  }

  const keyword = query.keyword?.trim().toLowerCase();
  if (keyword) {
    const text = [
      log.taskId,
      log.action,
      log.agentId ?? '',
      log.sessionKey ?? '',
      log.error ?? '',
      log.decision?.reason ?? '',
      log.decision?.nextDescription ?? '',
      log.decision?.llmError ?? '',
      stringifyForSearch(log.params),
      stringifyForSearch(log.result),
    ].join('\n').toLowerCase();

    if (!text.includes(keyword)) {
      return false;
    }
  }

  return true;
}

function queryTaskLogs(query: TaskLogQuery): TaskLog[] {
  const db = getDb();
  const { sql, args } = buildBaseTaskLogSelect(query);
  const rows = db.prepare(sql).all(...args) as RawTaskLogRow[];
  return rows
    .map(toTaskLog)
    .filter((log) => matchesAdvancedQuery(log, query));
}

export function writeTaskLog(input: TaskLogInput): void {
  const db = getDb();
  const now = Date.now();
  const ttl = 3 * 24 * 60 * 60 * 1000;
  const cutoff = now - ttl;

  db.prepare(`
    INSERT INTO task_logs (task_id, action, session_key, agent_id, params, result, error, created_at)
    VALUES (@task_id, @action, @session_key, @agent_id, @params, @result, @error, @created_at)
  `).run({
    task_id: input.taskId,
    action: input.action,
    session_key: input.sessionKey ?? null,
    agent_id: input.agentId ?? null,
    params: input.params ? JSON.stringify(input.params) : null,
    result: input.result ? JSON.stringify(input.result) : null,
    error: input.error ?? null,
    created_at: now,
  });

  db.prepare('DELETE FROM task_logs WHERE created_at < ?').run(cutoff);
}

export function countTaskLogs(taskId?: string, action?: string, query: TaskLogCompatQuery = {}): number {
  return queryTaskLogs({
    ...query,
    taskId,
    action,
  }).length;
}

export function getTaskLogs(taskId?: string, action?: string, limit = 200, offset = 0, query: TaskLogCompatQuery = {}): TaskLog[] {
  const logs = queryTaskLogs({
    ...query,
    taskId,
    action,
  });
  return logs.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
}
