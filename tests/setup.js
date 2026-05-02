/**
 * 测试环境初始化
 * 由 vitest.config.js 的 setupFiles 加载，全局只执行一次
 */
import { openDb, closeDb, getDb } from '../src/pool/db.js';
import { setWorkspaceRoot, completeTask, claimTask, getDb as opsGetDb } from '../src/pool/operations.js';
import { TaskStatus } from '../src/schema/task.js';
import { beforeEach, afterEach } from 'vitest';
import 'dotenv/config';

// 全局测试工作空间
export const TEST_WORKSPACE = '/tmp/m-team-test-' + process.pid;

beforeEach(() => {
  setWorkspaceRoot(TEST_WORKSPACE);
});

afterEach(() => {
  // 清理遗留的 RUNNING 任务，防止污染下一个测试
  try {
    const db = getDb();
    if (db) {
      const activeRows = db.prepare('SELECT task_id, executor FROM tasks WHERE status = ?').all(TaskStatus.RUNNING);
      for (const row of activeRows) {
        try {
          completeTask(row.task_id, { step: 'test-teardown', output: {} });
        } catch {}
      }
      db.exec('DELETE FROM tasks');
    }
  } catch {}
});
