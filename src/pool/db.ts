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

  if (!hasTaskType) db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'general';");
  if (!hasUpdatedAt) {
    db.exec("ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;");
    db.exec('UPDATE tasks SET updated_at = COALESCE(completed_at, created_at, 0) WHERE updated_at = 0');
  }
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
      (task_id, task_type, description, goal, context, priority, publisher,
       status, executor, last_executor, created_at, completed_at, updated_at)
    VALUES
      (@task_id, @task_type, @description, @goal, @context, @priority, @publisher,
       @status, @executor, @last_executor, @created_at, @completed_at, @updated_at)
  `).run(row);
}

export function updateTaskRow(taskId: string, patch: TaskPatch): Task | null {
  const db = getDb();

  const snakePatch: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    taskId: 'task_id',
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
}

export function countTaskLogs(taskId?: string, action?: string): number {
  const db = getDb();
  let sql = 'SELECT COUNT(*) AS count FROM task_logs';
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (taskId) {
    conditions.push('task_id = ?');
    args.push(taskId);
  }
  if (action) {
    conditions.push('action = ?');
    args.push(action);
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

  const row = db.prepare(sql).get(...args) as { count: number };
  return row.count;
}

export function getTaskLogs(taskId?: string, action?: string, limit = 200, offset = 0): TaskLog[] {
  const db = getDb();
  let sql = 'SELECT * FROM task_logs';
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (taskId) {
    conditions.push('task_id = ?');
    args.push(taskId);
  }
  if (action) {
    conditions.push('action = ?');
    args.push(action);
  }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const rows = db.prepare(sql).all(...args) as Array<{
    id: number;
    task_id: string;
    action: string;
    session_key: string | null;
    agent_id: string | null;
    params: string | null;
    result: string | null;
    error: string | null;
    created_at: number;
  }>;

  return rows.map(r => ({
    id: r.id,
    taskId: r.task_id,
    action: r.action,
    sessionKey: r.session_key,
    agentId: r.agent_id,
    params: r.params ? JSON.parse(r.params) : null,
    result: r.result ? JSON.parse(r.result) : null,
    error: r.error,
    createdAt: r.created_at,
  }));
}
