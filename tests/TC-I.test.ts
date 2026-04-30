/**
 * TC-I：文件系统持久化
 * 对应 docs/test-cases/TC-I.md
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { TEST_WORKSPACE } from './setup.js';
import { createMockApi } from './helpers/testApi.js';
import { registerTools } from '../src/tools/index.js';

const NOOP_CONFIG = { notifications: [] };

async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

function extract(result: { ok: boolean; data: unknown }): unknown {
  return result.ok ? result.data : result;
}

function getTask(result: { ok: boolean; data: unknown }): unknown {
  const data = extract(result) as { task?: unknown; success?: boolean };
  return data.task ?? data;
}

describe('TC-I：文件系统持久化', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-I1：publishTask 同步写入 task.json', () => {
    it('task.json 存在于 tasks/{taskId}/ 目录，内容与内存一致', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: '持久化测试', goal: 'goal' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      assert.ok(fs.existsSync(taskFile), 'task.json 应存在');

      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
      assert.equal(content.taskId, taskId);
      assert.equal(content.status, 'pending');
      assert.equal(content.description, '持久化测试');
    });
  });

  describe('TC-I2：relayTask 同步更新 task.json', () => {
    it('relay 后 task.json 中 status 为 PENDING，executor 为 null，lastExecutor 为 alice', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: 'step1', contextOutput: { summary: 'done' } });

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

      assert.equal(content.status, 'pending');
      assert.equal(content.executor, null);
      assert.equal(content.lastExecutor, 'alice');
      assert.equal(content.context.length, 2);
    });
  });

  describe('TC-I3：updateTask 同步更新 task.json', () => {
    it('updateTask 后 task.json 与数据库查询结果一致', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_update_task', { taskId, contextStep: 'step1', contextOutput: { result: 123 } });

      const taskFile = path.join(TEST_WORKSPACE, 'tasks', taskId, 'task.json');
      const content = JSON.parse(fs.readFileSync(taskFile, 'utf8'));

      const fromDb = getTask(await callTool(api, 'mteam_get_task', { taskId })) as { context: unknown[]; executor: string; status: string };
      assert.equal(content.context.length, fromDb.context.length);
      assert.equal(content.executor, fromDb.executor);
      assert.equal(content.status, fromDb.status);
    });
  });
});
