/**
 * M-Team SQLite — 任务持久化
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let /** @type {Database.Database} */ _db = null;

/**
 * @param {string} dbPath
 */
export function openDb(dbPath) {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('[m-team] db not opened, call openDb first');
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function isDbOpen() {
  return _db !== null;
}

/**
 * @param {Database.Database} db
 */
function initSchema(db) {
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

/**
 * @param {string} taskId
 * @returns {object|null}
 */
export function getTaskRow(taskId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId);
  if (!row) return null;
  return deserializeTask(row);
}

/**
 * @returns {object[]}
 */
export function getAllTaskRows() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  return rows.map(deserializeTask);
}

/**
 * @param {string} status
 * @returns {object[]}
 */
export function getTaskRowsByStatus(status) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE status = ? ORDER BY priority ASC, created_at ASC'
  ).all(status);
  return rows.map(deserializeTask);
}

/**
 * @param {string} executor
 * @returns {object|null}
 */
export function getTaskRowByExecutor(executor) {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM tasks WHERE executor = ? AND status = ?'
  ).get(executor, 'running');
  if (!row) return null;
  return deserializeTask(row);
}

/**
 * @param {object} task
 */
export function insertTask(task) {
  const db = getDb();
  db.prepare(`
    INSERT INTO tasks
      (task_id, description, goal, context, priority, publisher,
       status, executor, last_executor, created_at, completed_at, last_heartbeat_at)
    VALUES
      (@taskId, @description, @goal, @context, @priority, @publisher,
       @status, @executor, @lastExecutor, @createdAt, @completedAt, @lastHeartbeatAt)
  `).run(serializeTask(task));
}

/**
 * @param {string} taskId
 * @param {object} patch
 * @returns {object|null}
 */
export function updateTaskRow(taskId, patch) {
  const db = getDb();
  const sets = Object.keys(patch).map(k => `${sqlFieldName(k)} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE tasks SET ${sets} WHERE task_id = @taskId`);
  stmt.run({ ...patch, taskId });
  return getTaskRow(taskId);
}

/**
 * @param {string} taskId
 */
export function deleteTaskRow(taskId) {
  const db = getDb();
  db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
}

// ============================================================
// Serialization (task <-> row)
// ============================================================

/**
 * @param {object} task
 */
function serializeTask(task) {
  return {
    taskId: task.taskId,
    description: task.description,
    goal: task.goal,
    context: JSON.stringify(task.context),
    priority: task.priority,
    publisher: task.publisher,
    status: task.status,
    executor: task.executor,
    lastExecutor: task.lastExecutor,
    createdAt: task.createdAt,
    completedAt: task.completedAt ?? null,
    lastHeartbeatAt: task.lastHeartbeatAt ?? null
  };
}

/**
 * @param {object} row
 */
function deserializeTask(row) {
  return {
    taskId: row.task_id,
    description: row.description,
    goal: row.goal,
    context: JSON.parse(row.context),
    priority: row.priority,
    publisher: row.publisher,
    status: row.status,
    executor: row.executor,
    lastExecutor: row.last_executor,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    lastHeartbeatAt: row.last_heartbeat_at
  };
}

/** JSON → DB column name */
function sqlFieldName(key) {
  const map = {
    taskId: 'task_id',
    completedAt: 'completed_at',
    lastHeartbeatAt: 'last_heartbeat_at',
    lastExecutor: 'last_executor'
  };
  return map[key] ?? key;
}
