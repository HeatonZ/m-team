/**
 * 测试环境初始化
 * 每个测试文件开头顶部: import './setup.js';
 */

import { openDb, closeDb } from '../src/pool/db.js';
import path from 'node:path';
import fs from 'node:fs';

// 测试用临时数据库
const TEST_DB = '/tmp/m-team-test.db';
const TEST_WORKSPACE = '/tmp/m-team-test-workspace';

export function setup() {
  // 清理旧数据
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });

  openDb(TEST_DB);
}

export function teardown() {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

export { TEST_DB, TEST_WORKSPACE };
