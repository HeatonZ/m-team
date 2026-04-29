/**
 * TC-I：文件系统持久化
 * 对应 docs/test-cases/TC-I.md
 */
import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import path from 'node:path';
import fs from 'node:fs';
import { TEST_WORKSPACE } from './setup.js';
import { TaskStatus } from '../src/schema/task.js';
import * as pool from '../src/pool/index.js';
import * as ops from '../src/pool/operations.js';

describe('TC-I：文件系统持久化', () => {

  // TC-I1: publishTask 同步写入 task.json
  describe('TC-I1：publishTask 同步写入 task.json', () => {
    it('task.json 存在于 tasks/{taskId}/ 目录，内容与内存一致', () => {
      const taskId = ops.publishTask({ description: '持久化测试', goal: 'goal' });

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      assert(fs.existsSync(taskFile), 'task.json 应存在');

      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
      assert(content.taskId === taskId);
      assert(content.status === TaskStatus.PENDING);
      assert(content.description === '持久化测试');
    });
  });

  // TC-I2: relayTask 同步更新 task.json
  describe('TC-I2：relayTask 同步更新 task.json', () => {
    it('relay 后 task.json 中 status 为 PENDING，executor 为 null，lastExecutor 为 alice', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.relayTask(taskId, 'alice', { step: 'step1', output: { summary: 'done' } });

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

      assert(content.status === TaskStatus.PENDING);
      assert(content.executor === null);
      assert(content.lastExecutor === 'alice');
      assert(content.context.length === 2);
    });
  });

  // TC-I3: updateTask 同步更新 task.json
  describe('TC-I3：updateTask 同步更新 task.json', () => {
    it('updateTask 后 task.json 与数据库查询结果一致', () => {
      const taskId = ops.publishTask({ description: 'd', goal: 'g' });
      ops.claimTask(taskId, 'alice');
      ops.updateTask(taskId, null, { step: 'step1', output: { result: 123 } });

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

      const fromDb = pool.getTask(taskId);
      assert(content.context.length === fromDb.context.length);
      assert(content.executor === fromDb.executor);
      assert(content.status === fromDb.status);
    });
  });
});
