/**
 * Dashboard Server
 * Serves the UI and exposes a REST API backed by m-team pool.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setWorkspaceRoot, getAllTasks, getPendingTasks, getRunningTasks, getCompletedTasks, getFailedTasks, getCancelledTasks, getClosedTasks, getTask as getTaskById, updateTaskRow, STATUS_LABELS, PRIORITY_LABELS } from './src/db.ts';

const _scriptPath = import.meta.url
  ? fileURLToPath(import.meta.url)
  : process.argv[1];
const __dirname = path.dirname(_scriptPath);
// In production (bundled): script lives in repo/dist/, assets in repo/dashboard/dist/
// In development: script lives in repo/dashboard/, same layout
const REPO_ROOT = path.resolve(__dirname, '..');
const IS_PROD = !import.meta.url || !process.env.VITE_DEV;
const DASHBOARD_DIR = IS_PROD ? path.join(REPO_ROOT, 'dashboard') : __dirname;
const DIST = path.join(DASHBOARD_DIR, 'dist');
const PUBLIC = path.join(DASHBOARD_DIR, 'public');
const PORT = process.env.PORT || 3000;

// Initialise DB path
const WORKSPACE = process.env.WORKSPACE_ROOT || '/mnt/d/code/m-team';
setWorkspaceRoot(WORKSPACE);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml'
};

function send(res, status, body, contentType = 'application/json') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json');
}

async function handle(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // — API routes —
  if (pathname.startsWith('/api/')) {
    const seg = pathname.slice(4); // strip /api

    try {
      // GET /api/tasks/pending
      if (seg === '/tasks/pending') {
        const tasks = getPendingTasks();
        return json(res, 200, { tasks });
      }
      // GET /api/tasks/running
      if (seg === '/tasks/running') {
        const tasks = getRunningTasks();
        return json(res, 200, { tasks });
      }
      // GET /api/tasks/history?status=completed|failed|cancelled&page=1
      if (seg === '/tasks/history') {
        const status = url.searchParams.get('status') || 'completed';
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
        const pageSize = 20;
        let tasks, total;
        if (status === 'completed') { tasks = getCompletedTasks(); }
        else if (status === 'closed') { tasks = getClosedTasks(); }
        else if (status === 'failed') { tasks = getFailedTasks(); }
        else if (status === 'cancelled') { tasks = getCancelledTasks(); }
        else { tasks = []; }
        total = tasks.length;
        const totalPages = Math.ceil(total / pageSize);
        const paginated = tasks
          .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          .slice((page - 1) * pageSize, page * pageSize);
        return json(res, 200, { tasks: paginated, total, page, pageSize, totalPages });
      }
      // GET /api/tasks/:id
      const detailMatch = seg.match(/^\/tasks\/(task_\w+)$/);
      if (detailMatch && req.method === 'GET') {
        const task = getTaskById(detailMatch[1]);
        if (!task) return json(res, 404, { error: 'not found' });
        return json(res, 200, task);
      }
      // PATCH /api/tasks/:id
      const patchMatch = seg.match(/^\/tasks\/(task_\w+)$/);
      if (patchMatch && req.method === 'PATCH') {
        const taskId = patchMatch[1];
        let body = '';
        req.on('data', chunk => { body += chunk; });
        await new Promise<void>(resolve => { req.on('end', resolve); });
        const patch = JSON.parse(body);
        const task = updateTaskRow(taskId, patch);
        if (!task) return json(res, 404, { error: 'not found' });
        return json(res, 200, task);
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[dashboard server]', err);
      return json(res, 500, { error: 'internal error', message: err.message });
    }
  }

  // — Static files —
  // Prefer dist/ (production build) over public/ (dev assets)
  if (pathname === '/') pathname = '/index.html';
  const distPath = path.join(DIST, pathname);
  const publicPath = path.join(PUBLIC, pathname);

  // Try dist first
  try {
    const stat = fs.statSync(distPath);
    const ext = path.extname(distPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const body = fs.readFileSync(distPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
    return;
  } catch { /* fall through */ }

  // Try public
  try {
    const stat = fs.statSync(publicPath);
    const ext = path.extname(publicPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const body = fs.readFileSync(publicPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(body);
    return;
  } catch { /* fall through */ }

  // SPA fallback — serve dist/index.html
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