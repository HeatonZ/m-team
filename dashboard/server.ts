/**
 * Dashboard Server
 * Serves UI and exposes REST APIs backed by m-team pool.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setWorkspaceRoot,
  getPendingTasks,
  getRunningTasks,
  getCompletedTasks,
  getFailedTasks,
  getCancelledTasks,
  getClosedTasks,
  getTask as getTaskById,
  getDashboardLogs,
  countDashboardLogs,
} from './src/db.ts';

const _scriptPath = import.meta.url
  ? fileURLToPath(import.meta.url)
  : process.argv[1];
const __dirname = path.dirname(_scriptPath);

// In production (bundled): script in repo/dist/, assets in repo/dashboard/dist/
// In development: script in repo/dashboard/, same layout
const REPO_ROOT = path.resolve(__dirname, '..');
const IS_PROD = !import.meta.url || !process.env.VITE_DEV;
const DASHBOARD_DIR = IS_PROD ? path.join(REPO_ROOT, 'dashboard') : __dirname;
const DIST = path.join(DASHBOARD_DIR, 'dist');
const PUBLIC = path.join(DASHBOARD_DIR, 'public');
const PORT = process.env.PORT || 3000;

// Initialize DB path
const WORKSPACE = process.env.WORKSPACE_ROOT || '/mnt/d/workspace/m-team';
setWorkspaceRoot(WORKSPACE);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const LOG_DECISIONS = new Set(['next', 'complete', 'fail']);
const LOG_VIA = new Set(['llm', 'llm_fail_fast', 'llm_repeat_guard']);
const LOG_LLM_STATUS = new Set(['ok', 'error']);

function send(res: http.ServerResponse, status: number, body: string, contentType = 'application/json') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  send(res, status, JSON.stringify(data), 'application/json');
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // API routes
  if (pathname.startsWith('/api/')) {
    const seg = pathname.slice(4); // strip /api

    try {
      // GET /api/tasks/pending
      if (seg === '/tasks/pending') {
        return json(res, 200, { tasks: getPendingTasks() });
      }

      // GET /api/tasks/running
      if (seg === '/tasks/running') {
        return json(res, 200, { tasks: getRunningTasks() });
      }

      // GET /api/tasks/history?status=completed|closed|failed|cancelled&page=1
      if (seg === '/tasks/history') {
        const status = url.searchParams.get('status') || 'completed';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const pageSize = 20;

        let tasks;
        if (status === 'completed') tasks = getCompletedTasks();
        else if (status === 'closed') tasks = getClosedTasks();
        else if (status === 'failed') tasks = getFailedTasks();
        else if (status === 'cancelled') tasks = getCancelledTasks();
        else tasks = [];

        const total = tasks.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const paginated = tasks
          .sort((a, b) => (b.completedAt ?? b.updatedAt ?? 0) - (a.completedAt ?? a.updatedAt ?? 0))
          .slice((page - 1) * pageSize, page * pageSize);

        return json(res, 200, { tasks: paginated, total, page, pageSize, totalPages });
      }

      // GET /api/tasks/:id
      const taskMatch = seg.match(/^\/tasks\/(task_\w+)$/);
      if (taskMatch && req.method === 'GET') {
        const task = getTaskById(taskMatch[1]);
        if (!task) return json(res, 404, { error: 'not found' });
        return json(res, 200, task);
      }

      // GET /api/logs?taskId=...&action=...&page=1&pageSize=20
      if (seg === '/logs' && req.method === 'GET') {
        const taskId = (url.searchParams.get('taskId') || '').trim() || undefined;
        const action = (url.searchParams.get('action') || '').trim() || undefined;
        const agentId = (url.searchParams.get('agentId') || '').trim() || undefined;
        const sessionKey = (url.searchParams.get('sessionKey') || '').trim() || undefined;
        const decision = (url.searchParams.get('decision') || '').trim();
        const via = (url.searchParams.get('via') || '').trim();
        const llmStatus = (url.searchParams.get('llmStatus') || '').trim();
        const keyword = (url.searchParams.get('keyword') || '').trim() || undefined;
        const hasErrorRaw = (url.searchParams.get('hasError') || '').trim().toLowerCase();
        const hasError = hasErrorRaw === 'true' ? true : hasErrorRaw === 'false' ? false : undefined;
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const fallbackLimit = parseInt(url.searchParams.get('limit') || '20', 10);
        const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || String(fallbackLimit), 10)));
        const offset = (page - 1) * pageSize;

        const query = {
          taskId,
          action,
          agentId,
          sessionKey,
          decision: LOG_DECISIONS.has(decision) ? decision as 'next' | 'complete' | 'fail' : undefined,
          via: LOG_VIA.has(via) ? via as 'llm' | 'llm_fail_fast' | 'llm_repeat_guard' : undefined,
          llmStatus: LOG_LLM_STATUS.has(llmStatus) ? llmStatus as 'ok' | 'error' : undefined,
          hasError,
          keyword,
        };

        const total = countDashboardLogs(query);
        const logs = getDashboardLogs(query, pageSize, offset);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        return json(res, 200, { logs, total, page, pageSize, totalPages });
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[dashboard server]', err);
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 500, { error: 'internal error', message });
    }
  }

  // Static files
  if (pathname === '/') pathname = '/index.html';
  const distPath = path.join(DIST, pathname);
  const publicPath = path.join(PUBLIC, pathname);

  try {
    const ext = path.extname(distPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const body = fs.readFileSync(distPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
    return;
  } catch {
    // fall through
  }

  try {
    const ext = path.extname(publicPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const body = fs.readFileSync(publicPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
    return;
  } catch {
    // fall through
  }

  try {
    const body = fs.readFileSync(path.join(DIST, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`[dashboard] listening on http://localhost:${PORT}`);
});
