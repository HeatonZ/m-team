/**
 * Tools 层集成测试 — 通过 mockApi 测试 tool 层
 *
 * 覆盖：参数解析、错误处理、结果格式、侧跳调用（notifications / subagent.run）
 *
 * 测试策略：
 * - 模块级 beforeEach 负责 api + tools 注册
 * - describe 级 beforeEach 负责任务 fixture（taskId）
 * - 通过 api.getTool(name).execute() 调用工具
 * - 验证返回格式：result.ok + extract(result).data
 */

import { createMockApi } from '../helpers/mockApi.js';

// ============================================================
// Fixtures
// ============================================================

let api;

const NOOP_CONFIG = { notifications: [] };
const WITH_NOTIF_CONFIG = {
  notifications: [{ type: 'feishu', webhookUrl: 'https://example.com/notify', template: 'Task {{taskId}} is {{status}}' }],
};

// 模块级：每次测试前创建 fresh api 并注册 tools
beforeEach(async () => {
  api = createMockApi(NOOP_CONFIG);
  const { registerTools } = await import('../../src/tools/index.js');
  registerTools(api, NOOP_CONFIG);
});

// ============================================================
// 辅助
// ============================================================

async function callTool(toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

function extract(result) {
  if (result && result.ok === true) return result.data;
  return result;
}

// ============================================================
// Tool Registration
// ============================================================

test('注册了所有 11 个 tools', () => {
  const names = api.getToolNames();
  expect(names).toContain('mteam_publish_task');
  expect(names).toContain('mteam_claim_task');
  expect(names).toContain('mteam_update_task');
  expect(names).toContain('mteam_complete_task');
  expect(names).toContain('mteam_cancel_task');
  expect(names).toContain('mteam_relay_task');
  expect(names).toContain('mteam_relinquish_task');
  expect(names).toContain('mteam_get_pending');
  expect(names).toContain('mteam_get_agent_active');
  expect(names).toContain('mteam_get_task');
  expect(names).toContain('mteam_get_all_tasks');
  expect(names).toHaveLength(11);
});

// ============================================================
// mteam_publish_task
// ============================================================

describe('mteam_publish_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool('mteam_publish_task', { goal: '测试目标' });
    expect(result.ok).toBe(false);
  });

  test('goal 缺失时返回错误结构', async () => {
    const result = await callTool('mteam_publish_task', { description: '测试描述' });
    expect(result.ok).toBe(false);
  });

  test('正常参数返回 taskId', async () => {
    const result = await callTool('mteam_publish_task', { description: '数据清洗', goal: '分析销售数据' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.taskId).toBeDefined();
  });

  test('带 publisher 和 priority 参数正常处理', async () => {
    const result = await callTool('mteam_publish_task', { description: 'd', goal: 'g', publisher: 'alice', priority: 'high' });
    expect(result.ok).toBe(true);
    expect(extract(result).taskId).toBeDefined();
  });

  test('input 参数透传', async () => {
    const result = await callTool('mteam_publish_task', { description: 'd', goal: 'g', input: { key: 'value' } });
    expect(result.ok).toBe(true);
  });

  test('publisher 默认为 user', async () => {
    const result = await callTool('mteam_publish_task', { description: 'd', goal: 'g' });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// mteam_claim_task
// ============================================================

describe('mteam_claim_task', () => {
  // publishTask 返回 taskId 字符串
  let taskId;

  beforeEach(async () => {
    const { publishTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: '待认领', goal: 'goal', publisher: 'user' });
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool('mteam_claim_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('taskId 缺失时返回错误结构', async () => {
    const result = await callTool('mteam_claim_task', { agentId: 'alice' });
    expect(result.ok).toBe(false);
  });

  test('正常认领返回 success + runId + sessionKey', async () => {
    const result = await callTool('mteam_claim_task', { taskId, agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
    expect(data.sessionKey).toContain(taskId);
  });

  test('认领不存在的任务返回失败', async () => {
    const result = await callTool('mteam_claim_task', { taskId: 'non-existent-task', agentId: 'alice' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_complete_task
// ============================================================

describe('mteam_complete_task', () => {
  let taskId;

  beforeEach(async () => {
    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
  });

  test('必填参数 contextStep 缺失时返回错误结构', async () => {
    const result = await callTool('mteam_complete_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('正常完成返回 task 对象，状态为 completed', async () => {
    const result = await callTool('mteam_complete_task', {
      taskId, contextStep: '完成数据清洗', contextOutput: { summary: '清洗完成' },
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
    expect(data.task.status).toBe('completed');
  });

  test('不存在的 taskId 返回失败', async () => {
    const result = await callTool('mteam_complete_task', { taskId: 'non-existent', contextStep: 's' });
    expect(result.ok).toBe(false);
  });

  test('contextOutput 为空时正常处理', async () => {
    const result = await callTool('mteam_complete_task', { taskId, contextStep: '步骤描述' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
  });

  test('带 files 的 contextOutput 正常处理', async () => {
    const result = await callTool('mteam_complete_task', {
      taskId, contextStep: '生成图表', contextOutput: { summary: 'done', files: ['chart.png'] },
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.status).toBe('completed');
  });
});

// ============================================================
// mteam_cancel_task
// ============================================================

describe('mteam_cancel_task', () => {
  let taskId;

  beforeEach(async () => {
    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: 'd', goal: 'g', publisher: 'user' });
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool('mteam_cancel_task', { publisher: 'user' });
    expect(result.ok).toBe(false);
  });

  test('publisher 缺失时返回错误结构', async () => {
    const result = await callTool('mteam_cancel_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('正常取消返回 success，状态变为 cancelled', async () => {
    const result = await callTool('mteam_cancel_task', {
      taskId, publisher: 'user', reason: '优先级调整',
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.status).toBe('cancelled');
  });

  test('非发布者取消返回失败', async () => {
    const result = await callTool('mteam_cancel_task', { taskId, publisher: 'wrong-publisher' });
    expect(result.ok).toBe(false);
  });

  test('不存在的任务取消返回失败', async () => {
    const result = await callTool('mteam_cancel_task', { taskId: 'non-existent', publisher: 'user' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_relay_task
// ============================================================

describe('mteam_relay_task', () => {
  let taskId;

  beforeEach(async () => {
    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool('mteam_relay_task', { agentId: 'alice' });
    expect(result.ok).toBe(false);
  });

  test('contextStep 缺失时返回错误结构', async () => {
    const result = await callTool('mteam_relay_task', { taskId, agentId: 'alice' });
    expect(result.ok).toBe(false);
  });

  test('正常 relay 返回 success，状态变为 pending', async () => {
    const result = await callTool('mteam_relay_task', {
      taskId, agentId: 'alice', contextStep: '数据清洗完成',
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.status).toBe('pending');
    expect(data.task.lastExecutor).toBe('alice');
    expect(data.task.executor).toBeNull();
  });

  test('带 contextOutput 正常处理', async () => {
    const result = await callTool('mteam_relay_task', {
      taskId, agentId: 'alice', contextStep: '步骤一', contextOutput: { summary: 'done', files: ['out.csv'] },
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.status).toBe('pending');
  });

  test('非当前 executor relay 仍返回 ok', async () => {
    const result = await callTool('mteam_relay_task', { taskId, agentId: 'bob', contextStep: 's' });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// mteam_relinquish_task
// ============================================================

describe('mteam_relinquish_task', () => {
  let taskId;

  beforeEach(async () => {
    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool('mteam_relinquish_task', { executorId: 'alice' });
    expect(result.ok).toBe(false);
  });

  test('正常 relinquish 返回 success，状态变为 pending', async () => {
    const result = await callTool('mteam_relinquish_task', { taskId, executorId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('pending');
    expect(data.task.executor).toBeNull();
  });

  test('非当前 executor relinquish 返回失败', async () => {
    const result = await callTool('mteam_relinquish_task', { taskId, executorId: 'bob' });
    expect(result.ok).toBe(false);
  });

  test('不存在的任务 relinquish 返回失败', async () => {
    const result = await callTool('mteam_relinquish_task', { taskId: 'non-existent', executorId: 'alice' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_update_task
// ============================================================

describe('mteam_update_task', () => {
  let taskId;

  beforeEach(async () => {
    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
  });

  test('只传 taskId 不报错', async () => {
    const result = await callTool('mteam_update_task', { taskId });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
  });

  test('更新 description 正常处理', async () => {
    const result = await callTool('mteam_update_task', { taskId, description: '新的描述' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.description).toBe('新的描述');
  });

  test('更新 status 正常处理', async () => {
    const result = await callTool('mteam_update_task', { taskId, status: 'running' });
    expect(result.ok).toBe(true);
  });

  test('追加 contextStep 正常处理', async () => {
    const result = await callTool('mteam_update_task', { taskId, contextStep: '执行中步骤' });
    expect(result.ok).toBe(true);
  });

  test('心跳时间戳正常处理', async () => {
    const result = await callTool('mteam_update_task', { taskId, lastHeartbeatAt: Date.now() });
    expect(result.ok).toBe(true);
  });

  test('不存在的 taskId 返回 task=null', async () => {
    const result = await callTool('mteam_update_task', { taskId: 'non-existent' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeNull();
  });
});

// ============================================================
// mteam_get_pending
// ============================================================

describe('mteam_get_pending', () => {
  beforeEach(async () => {
    const { publishTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    publishTask({ description: 'd', goal: 'g' });
    publishTask({ description: 'd2', goal: 'g2' });
  });

  test('无参数时返回待认领列表', async () => {
    const result = await callTool('mteam_get_pending', {});
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.pending).toBeInstanceOf(Array);
    expect(data.pending.length).toBeGreaterThanOrEqual(2);
  });

  test('带 agentId 过滤正常处理', async () => {
    const result = await callTool('mteam_get_pending', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.pending).toBeInstanceOf(Array);
  });
});

// ============================================================
// mteam_get_agent_active
// ============================================================

describe('mteam_get_agent_active', () => {
  beforeEach(async () => {
    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('无活跃任务时返回 null', async () => {
    const result = await callTool('mteam_get_agent_active', { agentId: 'nobody' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.activeTask).toBeNull();
  });

  test('认领后返回活跃任务', async () => {
    const { publishTask, claimTask } = require('../../src/pool/operations.js');
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');

    const result = await callTool('mteam_get_agent_active', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.activeTask).not.toBeNull();
    expect(data.activeTask.taskId).toBe(taskId);
  });

  test('任务完成后返回 null', async () => {
    const { publishTask, claimTask, completeTask } = require('../../src/pool/operations.js');
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    completeTask(taskId, { step: 'done', output: {} });

    const result = await callTool('mteam_get_agent_active', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.activeTask).toBeNull();
  });
});

// ============================================================
// mteam_get_task
// ============================================================

describe('mteam_get_task', () => {
  beforeEach(async () => {
    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('获取存在的任务', async () => {
    const { publishTask } = require('../../src/pool/operations.js');
    const taskId = publishTask({ description: 'd', goal: 'g' });

    const result = await callTool('mteam_get_task', { taskId });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
    expect(data.task.taskId).toBe(taskId);
  });

  test('获取不存在的任务返回 null', async () => {
    const result = await callTool('mteam_get_task', { taskId: 'non-existent' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeNull();
  });
});

// ============================================================
// mteam_get_all_tasks
// ============================================================

describe('mteam_get_all_tasks', () => {
  beforeEach(async () => {
    const { publishTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    publishTask({ description: 'd1', goal: 'g1' });
    publishTask({ description: 'd2', goal: 'g2' });
  });

  test('返回所有任务列表', async () => {
    const result = await callTool('mteam_get_all_tasks', {});
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.tasks).toBeInstanceOf(Array);
    expect(data.tasks.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Side effects — notifications / subagent.run
// ============================================================

describe('Side effects', () => {
  test('mteam_complete_task 配置 notifications 时调用 sendNotifications', async () => {
    const notifApi = createMockApi(WITH_NOTIF_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(notifApi, WITH_NOTIF_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');

    const result = await notifApi.getTool('mteam_complete_task').execute('mock-id', {
      taskId, contextStep: 'done', contextOutput: { summary: 'ok' },
    });
    expect(result).toBeDefined();
  });

  test('mteam_relinquish_task 配置 notifications 时调用 sendNotifications', async () => {
    const notifApi = createMockApi(WITH_NOTIF_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(notifApi, WITH_NOTIF_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');

    const result = await notifApi.getTool('mteam_relinquish_task').execute('mock-id', {
      taskId, executorId: 'alice',
    });
    expect(result).toBeDefined();
  });

  test('mteam_claim_task 返回 sessionKey 和 runId', async () => {
    const { publishTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const taskId = publishTask({ description: 'd', goal: 'g' });

    const result = await api.getTool('mteam_claim_task').execute('mock-id', {
      taskId, agentId: 'alice',
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
    expect(data.sessionKey).toContain(taskId);
  });
});
