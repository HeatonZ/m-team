/**
 * Dashboard 服务管理 — 插件启动时 spawn，插件卸载时 kill。
 *
 * 优先使用 OpenClaw 官方生命周期钩子（gateway:shutdown / gateway:pre-restart），
 * SIGTERM/SIGTERM/SIGHUP 仅作 hard-kill 兜底。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let _dashboardProc: ChildProcess | null = null;
let _cleanedUp = false; // 防止 double cleanup

/**
 * 启动 dashboard HTTP 服务。
 * @param workspaceRoot  m-team 工作空间根目录（传给学生进程）
 * @param port            HTTP 监听端口（默认 3000）
 */
export function startDashboard(workspaceRoot: string, port = 3000): ChildProcess {
  if (_dashboardProc && !_dashboardProc.killed) {
    return _dashboardProc;
  }

  // Build target: dist/dashboard-server.cjs (bundled by scripts/bundle-dashboard-server.mjs)
  // This avoids tsx dependency in production.
  // Dev: node --import tsx dashboard/server.ts
  // Prod: node dist/dashboard-server.cjs
  const BUNDLED_SERVER = 'dist/dashboard-server.cjs';
  const DEV_SERVER = 'dashboard/server.ts';

  const repoRoot = getRepoRoot();
  const useBundled = !process.env.VITE_DEV;

  const serverEntry = useBundled
    ? path.join(repoRoot, BUNDLED_SERVER)
    : path.join(repoRoot, DEV_SERVER);
  const serverArgs = useBundled ? [] : ['--import', 'tsx'];

  const proc = spawn(
    process.execPath,
    [...serverArgs, serverEntry],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        WORKSPACE_ROOT: workspaceRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  proc.stdout?.on('data', (chunk) => {
    process.stdout.write(`[dashboard] ${chunk}`);
  });
  proc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[dashboard:err] ${chunk}`);
  });

  proc.on('error', (err) => {
    console.error('[m-team] dashboard spawn error:', err);
  });

  _dashboardProc = proc;
  console.log(`[m-team] dashboard started (pid=${proc.pid}), workspace=${workspaceRoot}`);
  return proc;
}

/** 停止 dashboard 进程（SIGTERM）。 */
export function stopDashboard(): void {
  if (_cleanedUp || !_dashboardProc || _dashboardProc.killed) {
    _dashboardProc = null;
    return;
  }
  _cleanedUp = true;
  const pid = _dashboardProc.pid;
  _dashboardProc.kill('SIGTERM');
  _dashboardProc = null;
  console.log(`[m-team] dashboard stopped (was pid=${pid})`);
}

/**
 * 注册 OpenClaw 生命周期钩子 + hard-kill 兜底信号。
 *
 * @param api           OpenClaw 插件 API（含 .on() 方法）
 * @param stopDashboard 回调，gateway shutdown 时调用
 */
export function registerDashboardCleanup(
  api: { on(event: string, handler: () => void | Promise<void>): void },
  stopDashboard: () => void,
): void {
  // 清理函数（幂等）
  const cleanup = () => {
    stopDashboard();
    setTimeout(() => process.exit(0), 100);
  };

  // OpenClaw 官方钩子
  api.on('gateway_stop', cleanup);

  // Hard-kill 兜底（nssm restart 等场景）
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.removeListener(sig, cleanup);
    process.on(sig, cleanup);
  }
}

/** 推算本仓库根目录（插件被 gateway 动态 import，import.meta.url 指向 node_modules 里的入口）。 */
function getRepoRoot(): string {
  try {
    // Bundled as CJS → use __dirname (set by Node.js to the directory of the CJS file)
    // dist/index.js → dist/ → repo root
    return path.resolve(__dirname, '..');
  } catch {
    // Fallback: use process.cwd() (typically the openclaw state dir)
    return process.cwd();
  }
}
