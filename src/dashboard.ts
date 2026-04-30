/**
 * Dashboard 服务管理 — 插件启动时 spawn，插件卸载时 kill。
 *
 * OpenClaw 插件无 unload 钩子，故通过 process signal（SIGTERM/SIGINT）
 * 在插件进程退出时同步关闭 dashboard 子进程。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dashboard server 入口（相对于本仓库根目录）
const DASHBOARD_SERVER = 'dashboard/server.ts';

let _dashboardProc: ChildProcess | null = null;

/**
 * 启动 dashboard HTTP 服务。
 * @param workspaceRoot  m-team 工作空间根目录（传给学生进程）
 * @param port            HTTP 监听端口（默认 3000）
 */
export function startDashboard(workspaceRoot: string, port = 3000): ChildProcess {
  if (_dashboardProc && !_dashboardProc.killed) {
    return _dashboardProc;
  }

  const repoRoot = getRepoRoot();

  // 用 node --import tsx 运行 dashboard（tsx 已作为 runtime 依赖安装）
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', DASHBOARD_SERVER],
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
  if (!_dashboardProc || _dashboardProc.killed) {
    _dashboardProc = null;
    return;
  }
  const pid = _dashboardProc.pid;
  _dashboardProc.terminate();
  _dashboardProc.kill('SIGTERM');
  _dashboardProc = null;
  console.log(`[m-team] dashboard stopped (was pid=${pid})`);
}

/**
 * 注册插件进程的信号处理器，确保卸载时 dashboard 一起停。
 * 覆盖同一 sig 的所有已有 handler（只注册一次）。
 */
export function registerDashboardCleanup(): void {
  const cleanup = () => {
    stopDashboard();
    // Give SIGTERM a moment to propagate before exiting
    setTimeout(() => process.exit(0), 100);
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    // Only register once per signal to avoid double-cleanup
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
