/**
 * M-Team SQLite — 任务持久化
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { TaskRow, serializeTask, deserializeTask } from '../schema/db-types';
import type { Task } from '../schema/task';

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
      last_heartbeat_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_executor   ON tasks(executor);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority   ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
  `);
}

// ============================================================
// CRUD helpers
// ============================================================

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
  const row = db.prepare(
    'SELECT * FROM tasks WHERE executor = ? AND status = ?'
  ).get(executor, 'running') as TaskRow | undefined;
  if (!row) return null;
  return deserializeTask(row);
}

export function insertTask(task: Task): void {
  const db = getDb();
  const row = serializeTask(task);
  db.prepare(`
    INSERT INTO tasks
      (task_id, description, goal, context, priority, publisher,
       status, executor, last_executor, created_at, completed_at, last_heartbeat_at)
    VALUES
      (@task_id, @description, @goal, @context, @priority, @publisher,
       @status, @executor, @last_executor, @created_at, @completed_at, @last_heartbeat_at)
  `).run(row);
}

export function updateTaskRow(taskId: string, patch: Record<string, unknown>): Task | null {
  const db = getDb();

  const snakePatch: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    taskId: 'task_id',
    completedAt: 'completed_at',
    lastHeartbeatAt: 'last_heartbeat_at',
    lastExecutor: 'last_executor'
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
