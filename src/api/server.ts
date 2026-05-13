/**
 * M-Team API Server
 * Thin HTTP wrapper around the CLI.
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CLI_SCRIPT = path.join(ROOT, 'src/cli/index.ts');
const TSX = path.join(ROOT, 'node_modules/.bin/tsx');

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
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function cli(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [CLI_SCRIPT, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || ROOT,
        FORCE_COLOR: '0',
      },
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout, stderr, code: 124 });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = stdout
        .split('\n')
        .filter((line) => !line.startsWith('[m-team-pool]'))
        .join('\n')
        .trim();
      resolve({ stdout: clean, stderr, code: code ?? 0 });
    });
  });
}

function readContextOutput(body: Record<string, unknown>): {
  summary?: string;
  files?: string[] | string;
  unresolvedIssues?: string[] | string;
  error?: string;
} {
  return (body.contextOutput ?? {}) as {
    summary?: string;
    files?: string[] | string;
    unresolvedIssues?: string[] | string;
    error?: string;
  };
}

function pushContextOutputArgs(args: string[], body: Record<string, unknown>): void {
  const contextOutput = readContextOutput(body);
  if (contextOutput.summary) args.push('--summary', String(contextOutput.summary));
  if (contextOutput.files) {
    args.push('--files', Array.isArray(contextOutput.files) ? contextOutput.files.join(',') : String(contextOutput.files));
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/^\/api\/mteam/, '');

  if (req.method === 'POST' && pathname === '/tasks') {
    try {
      const body = await parseBody(req);
      const args = ['tasks', 'create'];
      if (body.goal) args.push('--goal', String(body.goal));
      if (body.description) args.push('--description', String(body.description));
      if (body.taskType) args.push('--task-type', String(body.taskType));
      if (body.publisher) args.push('--publisher', String(body.publisher));
      if (body.priority) args.push('--priority', String(body.priority));

      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr || 'CLI error');
      return json(res, 201, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  if (req.method === 'GET' && pathname === '/tasks') {
    const status = url.searchParams.get('status') ?? 'pending';
    const result = await cli(['tasks', 'list', '--status', status]);
    try {
      return json(res, 200, JSON.parse(result.stdout));
    } catch {
      return error(res, 500, result.stderr || 'CLI parse error');
    }
  }

  const taskIdMatch = pathname.match(/^\/tasks\/(task_\w+)$/);
  if (req.method === 'GET' && taskIdMatch) {
    const result = await cli(['tasks', 'get', taskIdMatch[1]]);
    if (result.code !== 0) return error(res, 404, 'Task not found');
    try {
      return json(res, 200, JSON.parse(result.stdout));
    } catch {
      return error(res, 500, result.stderr);
    }
  }

  const claimMatch = pathname.match(/^\/tasks\/(task_\w+)\/claim$/);
  if (req.method === 'POST' && claimMatch) {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');

      const result = await cli(['tasks', 'claim', claimMatch[1], '--agent-id', String(body.agentId)]);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  const completeMatch = pathname.match(/^\/tasks\/(task_\w+)\/complete$/);
  if (req.method === 'POST' && completeMatch) {
    try {
      const body = await parseBody(req);
      if (!body.contextStep) return error(res, 400, 'contextStep required');

      const args = ['tasks', 'complete', completeMatch[1], '--step', String(body.contextStep)];
      pushContextOutputArgs(args, body);

      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  const nextMatch = pathname.match(/^\/tasks\/(task_\w+)\/next$/);
  if (req.method === 'POST' && nextMatch) {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');
      if (!body.contextStep) return error(res, 400, 'contextStep required');

      const args = ['tasks', 'next', nextMatch[1], '--agent-id', String(body.agentId), '--step', String(body.contextStep)];
      pushContextOutputArgs(args, body);
      if (body.description) args.push('--description', String(body.description));
      if (body.nextTaskType) args.push('--next-task-type', String(body.nextTaskType));

      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

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
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  const closeMatch = pathname.match(/^\/tasks\/(task_\w+)\/close$/);
  if (req.method === 'POST' && closeMatch) {
    try {
      const body = await parseBody(req);
      if (!body.publisher) return error(res, 400, 'publisher required');

      const result = await cli(['tasks', 'close', closeMatch[1], '--publisher', String(body.publisher)]);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  const relinquishMatch = pathname.match(/^\/tasks\/(task_\w+)\/relinquish$/);
  if (req.method === 'POST' && relinquishMatch) {
    try {
      const body = await parseBody(req);
      if (!body.executorId) return error(res, 400, 'executorId required');

      const args = ['tasks', 'relinquish', relinquishMatch[1], '--executor-id', String(body.executorId)];
      if (body.reason) args.push('--reason', String(body.reason));

      const result = await cli(args);
      if (result.code !== 0) return error(res, 400, result.stderr);
      return json(res, 200, JSON.parse(result.stdout));
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  if (req.method === 'GET' && pathname === '/executors') {
    const result = await cli(['executors', 'list']);
    try {
      return json(res, 200, JSON.parse(result.stdout));
    } catch {
      return error(res, 500, result.stderr || 'CLI parse error');
    }
  }

  if (req.method === 'GET' && pathname === '/executors/active') {
    const agentId = url.searchParams.get('agentId');
    if (!agentId) return error(res, 400, 'agentId query param required');

    const result = await cli(['executors', 'active', '--agent-id', agentId]);
    try {
      return json(res, 200, JSON.parse(result.stdout));
    } catch {
      return error(res, 500, result.stderr || 'CLI parse error');
    }
  }

  if (req.method === 'POST' && pathname === '/heartbeat') {
    try {
      const body = await parseBody(req);
      if (!body.agentId) return error(res, 400, 'agentId required');

      const result = await cli(['heartbeat', '--agent-id', String(body.agentId)]);
      try {
        return json(res, 200, JSON.parse(result.stdout));
      } catch {
        return json(res, 200, { raw: result.stdout });
      }
    } catch (e: any) {
      return error(res, 400, e.message);
    }
  }

  return error(res, 404, `Route not found: ${req.method} ${pathname}`);
}

http.createServer(handle).listen(PORT, () => {
  console.log(`[mteam-api] listening on http://localhost:${PORT}`);
  console.log(`[mteam-api] workspace: ${process.env.WORKSPACE_ROOT || '/mnt/d/code/m-team'}`);
});
