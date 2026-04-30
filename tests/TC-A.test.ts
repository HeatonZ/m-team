/**
 * TC-A：正常完成流程（工具层测试）
 * 对应 docs/test-cases/TC-A.md
 * 测试策略：通过 mockApi + registerTools 调用 mteam_* 工具接口
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert';
import { createMockApi } from './helpers/testApi.js';
import { closeDb } from '../src/pool/db.js';
import { setWorkspaceRoot } from '../src/pool/operations.js';
import { registerTools } from '../src/tools/index.js';

const NOOP_CONFIG = { notifications: [] };

/** 调用 tool，返回原始结果 */
async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

/** 从 jsonResult { ok, data } 中提取 data */
function extract(result: { ok: boolean; data: unknown }): unknown {
  return result.data;
}

/** 从工具返回结构中提取 task 对象 */
function getTask(result: { ok: boolean; data: unknown }): unknown {
  const data = extract(result) as { task?: unknown; success?: boolean };
  return data.task ?? data;
}

describe('TC-A：正常完成流程', () => {

  let api: ReturnType<typeof createMockApi>;

  beforeEach(async () => {
    closeDb();
    setWorkspaceRoot('/tmp/m-team-test-' + process.pid);
    api = createMockApi(NOOP_CONFIG);
    await registerTools(api, NOOP_CONFIG);
  });

  describe('TC-A1：Agent 完整执行并完成任务', () => {
    it('publishTask 创建任务，状态为待认领，上下文长度为1', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', {
        description: '分析销售数据',
        goal: '生成月报',
        publisher: 'boss',
        priority: 'high'
      });
      const pubData = extract(pubResult) as { taskId: string };

      const taskResult = await callTool(api, 'mteam_get_task', { taskId: pubData.taskId });
      const task = getTask(taskResult as { ok: boolean; data: unknown }) as {
        status: string; context: unknown[]; priority: string; publisher: string
      };

      assert.equal(task.status, 'pending');
      assert.equal(task.context.length, 1);
      assert.equal((task.context[0] as { type: string }).type, 'input');
      assert.equal(task.priority, 'high');
      assert.equal(task.publisher, 'boss');
    });

    it('alice 认领任务，状态变为 running，执行人变为 alice', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;

      const claimResult = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      const claimData = extract(claimResult) as { success: boolean; task: { status: string; executor: string } };

      assert.equal(claimData.success, true);
      assert.equal(claimData.task.status, 'running');
      assert.equal(claimData.task.executor, 'alice');
    });

    it('alice relay 数据清洗，任务变为 pending，context 长度为2', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const relayResult = await callTool(api, 'mteam_relay_task', {
        taskId, agentId: 'alice',
        contextStep: '数据清洗',
        contextOutput: { summary: '清洗5000行', files: ['清洗结果.json'] }
      });
      const relayData = extract(relayResult) as { success: boolean; task: unknown };
      const relayTask = relayData.task as { status: string; executor: string; lastExecutor: string; context: unknown[] };

      assert.equal(relayData.success, true);
      assert.equal(relayTask.status, 'pending');
      assert.equal(relayTask.executor, null);
      assert.equal(relayTask.lastExecutor, 'alice');
      assert.equal(relayTask.context.length, 2);
      assert.equal((relayTask.context[1] as { step: string }).step, '数据清洗');
    });

    it('bob relay 生成图表，context 长度为3', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: '数据清洗', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });

      const relayResult = await callTool(api, 'mteam_relay_task', {
        taskId, agentId: 'bob',
        contextStep: '生成图表',
        contextOutput: { summary: '生成3张图表', files: ['图表1.png', '图表2.png', '图表3.png'] }
      });
      const relayData = extract(relayResult) as { success: boolean; task: unknown };
      const relayTask = relayData.task as { status: string; executor: string; lastExecutor: string; context: unknown[] };

      assert.equal(relayData.success, true);
      assert.equal(relayTask.status, 'pending');
      assert.equal(relayTask.executor, null);
      assert.equal(relayTask.lastExecutor, 'bob');
      assert.equal(relayTask.context.length, 3);
      assert.equal((relayTask.context[1] as { step: string }).step, '数据清洗');
      assert.equal((relayTask.context[2] as { step: string }).step, '生成图表');
    });

    it('alice 再次认领并 complete，任务完成，context 长度为4', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: '数据清洗', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'bob', contextStep: '生成图表', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const completeResult = await callTool(api, 'mteam_complete_task', {
        taskId,
        contextStep: '最终提交',
        contextOutput: { summary: '月报已完成' }
      });
      const task = getTask(completeResult) as { status: string; completedAt: number | null; executor: string; context: unknown[] };

      assert.equal(task.status, 'completed');
      assert.notEqual(task.completedAt, null);
      assert.equal(task.executor, null);
      assert.equal(task.context.length, 4);
      assert.equal((task.context[3] as { step: string }).step, '最终提交');
    });

    it('任务完成后，alice 的活跃任务返回空', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice', contextStep: '数据清洗', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      await callTool(api, 'mteam_relay_task', { taskId, agentId: 'bob', contextStep: '生成图表', contextOutput: {} });
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_complete_task', { taskId, contextStep: '最终提交', contextOutput: {} });

      const activeResult = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
      const activeData = extract(activeResult) as { activeTask: null };

      assert.equal(activeData.activeTask, null);
    });

    it('任务完成后，alice 的待认领任务返回空', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
      await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'done', contextOutput: {} });

      const pendingResult = await callTool(api, 'mteam_get_pending', { agentId: 'alice' });
      const pendingData = extract(pendingResult) as { pending: unknown[] };

      assert.equal(pendingData.pending.length, 0);
    });
  });

  describe('TC-A2：心跳保活', () => {
    it('心跳只更新时间戳，不追加 context，不改变状态', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const updateResult = await callTool(api, 'mteam_update_task', {
        taskId,
        lastHeartbeatAt: Date.now()
      });
      const updated = getTask(updateResult as { ok: boolean; data: unknown }) as {
        status: string; context: unknown[]; lastHeartbeatAt: number | null
      };

      assert.equal(updated.status, 'running');
      assert.equal(updated.context.length, 1);
      assert.notEqual(updated.lastHeartbeatAt, null);
    });
  });

  describe('TC-A3：快速完成（一步完成）', () => {
    it('alice 认领后直接 complete，context 长度为2', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const completeResult = await callTool(api, 'mteam_complete_task', {
        taskId,
        contextStep: '任务完成',
        contextOutput: { summary: '完成' }
      });
      const task = getTask(completeResult) as { status: string; completedAt: number | null; context: unknown[] };

      assert.equal(task.status, 'completed');
      assert.notEqual(task.completedAt, null);
      assert.equal(task.context.length, 2);
      assert.equal((task.context[1] as { step: string }).step, '任务完成');
    });
  });

  describe('TC-A4：relay_task 交接流转', () => {
    it('relay 后下一个 agent 可继续执行', async () => {
      const pubResult = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
      const taskId = (extract(pubResult) as { taskId: string }).taskId;
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });

      const relayResult = await callTool(api, 'mteam_relay_task', {
        taskId, agentId: 'alice',
        contextStep: '第一步',
        contextOutput: { files: ['step1_out.json'] }
      });
      const relayData = extract(relayResult) as { success: boolean; task: unknown };
      const relayTask = relayData.task as { status: string };
      assert.equal(relayData.success, true);
      assert.equal(relayTask.status, 'pending');

      const claimResult = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'bob' });
      const claimData = extract(claimResult) as { success: boolean; task: { executor: string } };
      assert.equal(claimData.success, true);
      assert.equal(claimData.task.executor, 'bob');
    });
  });
});
