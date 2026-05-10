/**
 * M-Team API Server
 * Thin HTTP wrapper that invokes the CLI via child_process.
 *
 * 所有请求无认证（内网使用）。
 *
 * 启动:
 *   npx tsx src/api/server.ts
 *   PORT=3001 npx tsx src/api/server.ts
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..'); // m-team repo root
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CLI_SCRIPT = path.join(ROOT, 'src/cli/index.ts');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');

// ─── Utilities ────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

function error(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cli(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [CLI_SCRIPT, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || ROOT, FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout, stderr, code: 124 });
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => {
      clearTimeout(timer);
      // 过滤掉 pool operations 的 console.log 输出（[m-team-pool] 前缀）
      const clean = stdout.split('\n').filter(l => !l.startsWith('[m-team-pool]')).join('\n').trim();
      resolve({ stdout: clean, stderr, code: code ?? 0 });
    });
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/^\/api\/mteam/, ''); // strip /api/mteam prefix

  // ── Tasks ────────────────────────────────────────────────────────

  // POST /api/mteam/tasks  → create
  if (req.method === 'POST' && pathname === '/tasks') {
    try {
      const body = await parseBody(req);
      const args = ['tasks', 'create'];
      if (body.goal)             { args.push('--goal', String(body.goal)); }
      if (body.description)      { args.push('--description', String(body.description)); }
      if (body.taskType)         { args.push('--task-type', String(body.taskType)); }
      if (body.publisher)         { args.push('--publisher', String(body.publisher)); }
      if (body.priority)          { args.push('--priority', String(body.priority)); }
      if (body.tags)              { args.push('--tags', String(body.tags)); }

      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr || 'CLI error');
      const data = JSON.parse(result.stdout);
      return json(res, 201, data);
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // GET /api/mteam/tasks → list
  if (req.method === 'GET' && pathname === '/tasks') {
    const status = url.searchParams.get('status') ?? 'pending';
    const result = await cli(['tasks', 'list', '--status', status]);
    try { return json(res, 200, JSON.parse(result.stdout)); }
    catch { return error(res, 500, result.stderr || 'CLI parse error'); }
  }

  // GET /api/mteam/tasks/:id → get
  const taskIdMatch = pathname.match(/^\/tasks\/(task_\w+)$/);
  if (req.method === 'GET' && taskIdMatch) {
    const result = await cli(['tasks', 'get', taskIdMatch[1]]);
    if (result.code !== 0) return error(res, 404, 'Task not found');
    try { return json(res, 200, JSON.parse(result.stdout)); }
    catch { return error(res, 500, result.stderr); }
  }

  // POST /api/mteam/tasks/:id/claim → claim
  const claimMatch = pathname.match(/^\/tasks\/(task_\w+)\/claim$/);
  if (req.method === 'POST' && claimMatch) {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');
      const result = await cli(['tasks', 'claim', claimMatch[1], '--agent-id', String(body.agentId)]);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // POST /api/mteam/tasks/:id/complete → complete
  const completeMatch = pathname.match(/^\/tasks\/(task_\w+)\/complete$/);
  if (req.method === 'POST' && completeMatch) {
    try {
      const body = await parseBody(req);
      if (!body.contextStep) return error(res, 400, 'contextStep required');
      const args = ['tasks', 'complete', completeMatch[1], '--step', String(body.contextStep)];
      if (body.contextOutput?.summary) args.push('--summary', String(body.contextOutput.summary));
      if (body.contextOutput?.files)  args.push('--files', String(body.contextOutput.files));
      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // POST /api/mteam/tasks/:id/relay → relay
  const relayMatch = pathname.match(/^\/tasks\/(task_\w+)\/relay$/);
  if (req.method === 'POST' && relayMatch) {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');
      if (!body.contextStep) return error(res, 400, 'contextStep required');
      const args = ['tasks', 'relay', relayMatch[1], '--agent-id', String(body.agentId), '--step', String(body.contextStep)];
      if (body.contextOutput?.summary) args.push('--summary', String(body.contextOutput.summary));
      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // POST /api/mteam/tasks/:id/cancel → cancel
  const cancelMatch = pathname.match(/^\/tasks\/(task_\w+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    try {
      const body = await parseBody(req);
      if (!body.publisher) return error(res, 400, 'publisher required');
      const args = ['tasks', 'cancel', cancelMatch[1], '--publisher', String(body.publisher)];
      if (body.reason) args.push('--reason', String(body.reason));
      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // POST /api/mteam/tasks/:id/close → close
  const closeMatch = pathname.match(/^\/tasks\/(task_\w+)\/close$/);
  if (req.method === 'POST' && closeMatch) {
    try {
      const body = await parseBody(req);
      if (!body.publisher) return error(res, 400, 'publisher required');
      const result = await cli(['tasks', 'close', closeMatch[1], '--publisher', String(body.publisher)]);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // POST /api/mteam/tasks/:id/relinquish → relinquish
  const relinquMatch = pathname.match(/^\/tasks\/(task_\w+)\/relinquish$/);
  if (req.method === 'POST' && relinquMatch) {
    try {
      const body = await parseBody(req);
      if (!body.executorId) return error(res, 400, 'executorId required');
      const args = ['tasks', 'relinquish', relinquMatch[1], '--executor-id', String(body.executorId)];
      if (body.reason) args.push('--reason', String(body.reason));
      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // PUT /api/mteam/tasks/:id → update
  if (req.method === 'PUT' && taskIdMatch) {
    try {
      const body = await parseBody(req);
      const args = ['tasks', 'update', taskIdMatch[1]];
      if (body.status)      args.push('--status', String(body.status));
      if (body.contextStep)  args.push('--step', String(body.contextStep));
      if (body.description) args.push('--description', String(body.description));
      if (body.executorId)   args.push('--executor-id', String(body.executorId));
      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // ── Executors ────────────────────────────────────────────────────

  // GET /api/mteam/executors → list
  if (req.method === 'GET' && pathname === '/executors') {
    const result = await cli(['executors', 'list']);
    try { return json(res, 200, JSON.parse(result.stdout)); }
    catch { return error(res, 500, result.stderr || 'CLI parse error'); }
  }

  // GET /api/mteam/executors/active?agentId=X → active
  if (req.method === 'GET' && pathname === '/executors/active') {
    const agentId = url.searchParams.get('agentId');
    if (!agentId) return error(res, 400, 'agentId query param required');
    const result = await cli(['executors', 'active', '--agent-id', agentId]);
    try { return json(res, 200, JSON.parse(result.stdout)); }
    catch { return error(res, 500, result.stderr || 'CLI parse error'); }
  }

  // ── Heartbeat ───────────────────────────────────────────────────

  // POST /api/mteam/heartbeat → heartbeat
  if (req.method === 'POST' && pathname === '/heartbeat') {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');
      const result = await cli(['heartbeat', '--agent-id', String(body.agentId)]);
      try { return json(res, 200, JSON.parse(result.stdout)); }
      catch { return json(res, 200, { raw: result.stdout }); }
    } catch (e: any) { return error(res, 400, e.message); }
  }

  // ── 404 ─────────────────────────────────────────────────────────

  return error(res, 404, `Route not found: ${req.method} ${pathname}`);
}

// ─── Start ───────────────────────────────────────────────────────────────────

http.createServer(handle).listen(PORT, () => {
  console.log(`[mteam-api] listening on http://localhost:${PORT}`);
  console.log(`[mteam-api] workspace: ${process.env.WORKSPACE_ROOT || '/mnt/d/code/m-team'}`);
});
