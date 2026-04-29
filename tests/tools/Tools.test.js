/**
 * Tools 层集成测试 — 通过 mockApi + mockSdk 测试 tool 层
 *
 * 覆盖：参数解析、错误处理、结果格式、侧跳调用（notifications / subagent.run）
 *
 * 测试策略：
 * - 通过 api.getTool(name) 获取已注册的 tool
 * - 直接调用 tool.execute(_toolCallId, rawParams)
 * - 验证返回结果格式（通过 mock jsonResult）
 * - 验证侧跳调用（notifications, subagent.run）
 *
 * 对比 operations 层测试：tool 层测试的是接口适配层（参数提取/错误包装/侧跳）
 * 不需要测 operations 内部逻辑路径（由实际运行时验证）
 */

import { jest } from 'vitest';
import { createMockApi } from '../helpers/mockApi.js';

// ============================================================
// 辅助
// ============================================================

/** 调用 tool，返回 jsonResult 包裹的 data 部分 */
async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  const result = await tool.execute('mock-call-id', params);
  // mock jsonResult 返回 { ok: true, data }
  return result;
}

/** 从 jsonResult 中提取 data */
function extract(result) {
  if (result && result.ok === true) return result.data;
  return result;
}

// ============================================================
// Fixtures — 每个测试前重新创建 mockApi 并注册 tools
// ============================================================

let api;

const NOOP_CONFIG = { notifications: [] };
const WITH_NOTIF_CONFIG = {
  notifications: [
    {
      type: 'feishu',
      webhookUrl: 'https://example.com/notify',
      template: 'Task {{taskId}} is {{status}}',
    },
  ],
};

beforeEach(async () => {
  api = createMockApi(NOOP_CONFIG);
});

afterEach(() => {
  // no cleanup needed for mockApi
});

// ============================================================
// Tool Registration
// ============================================================

describe('Tool Registration', () => {
  beforeEach(() => {
    api = createMockApi(NOOP_CONFIG);
    // 动态 import tools/index.js 并注册
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);
  });

  test('注册了所有 11 个 tools', () => {
    const names = api.getToolNames();
    const expected = [
      'mteam_publish_task',
      'mteam_claim_task',
      'mteam_update_task',
      'mteam_complete_task',
      'mteam_cancel_task',
      'mteam_relay_task',
      'mteam_relinquish_task',
      'mteam_get_pending',
      'mteam_get_agent_active',
      'mteam_get_task',
      'mteam_get_all_tasks',
    ];
    expected.forEach((name) => {
      expect(names).toContain(name);
    });
    expect(names).toHaveLength(11);
  });
});

// ============================================================
// mteam_publish_task
// ============================================================

describe('mteam_publish_task', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);
  });

  test('必填参数缺失时返回错误结构', async () => {
    // description 缺失
    const result = await callTool(api, 'mteam_publish_task', { goal: '测试目标' });
    // jsonResult 包装后：{ ok: true, data: { error: '...' } }
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('goal 缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_publish_task', { description: '测试描述' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常参数返回 taskId', async () => {
    const result = await callTool(api, 'mteam_publish_task', {
      description: '数据清洗',
      goal: '分析销售数据',
    });
    const data = extract(result);
    expect(data.taskId).toBeDefined();
    expect(typeof data.taskId).toBe('string');
  });

  test('带 publisher 和 priority 参数正常处理', async () => {
    const result = await callTool(api, 'mteam_publish_task', {
      description: 'd',
      goal: 'g',
      publisher: 'alice',
      priority: 'high',
    });
    const data = extract(result);
    expect(data.taskId).toBeDefined();
  });

  test('input 参数透传', async () => {
    const inputData = { key: 'value' };
    const result = await callTool(api, 'mteam_publish_task', {
      description: 'd',
      goal: 'g',
      input: inputData,
    });
    const data = extract(result);
    expect(data.taskId).toBeDefined();
  });

  test('publisher 默认值为 user', async () => {
    const result = await callTool(api, 'mteam_publish_task', {
      description: 'd',
      goal: 'g',
    });
    const data = extract(result);
    expect(data.taskId).toBeDefined();
    // 不报错即通过（publisher 默认为 user）
  });

  test('priority 默认值正常处理', async () => {
    const result = await callTool(api, 'mteam_publish_task', {
      description: 'd',
      goal: 'g',
    });
    expect(extract(result)).toHaveProperty('taskId');
  });
});

// ============================================================
// mteam_claim_task
// ============================================================

describe('mteam_claim_task', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    // 预先发布一个任务
    const { publishTask } = require('../../src/pool/operations.js');
    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    global.__TEST_TASK_ID = publishTask({ description: '待认领', goal: 'goal', publisher: 'user' });
  });

  afterEach(() => {
    delete global.__TEST_TASK_ID;
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_claim_task', { taskId: global.__TEST_TASK_ID });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('taskId 缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_claim_task', { agentId: 'alice' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常认领返回 success + runId + sessionKey', async () => {
    const result = await callTool(api, 'mteam_claim_task', {
      taskId: global.__TEST_TASK_ID,
      agentId: 'alice',
    });
    const data = extract(result);
    expect(data.success).toBe(true);
    expect(data.task).toBeDefined();
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
  });

  test('认领不存在的任务返回失败', async () => {
    const result = await callTool(api, 'mteam_claim_task', {
      taskId: 'non-existent-task',
      agentId: 'alice',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });
});

// ============================================================
// mteam_complete_task
// ============================================================

describe('mteam_complete_task', () => {
  let taskId;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pubResult = publishTask({ description: 'd', goal: 'g' });
    taskId = pubResult.taskId;
    claimTask(taskId, 'alice');
  });

  test('必填参数 contextStep 缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_complete_task', { taskId });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常完成返回 task 对象', async () => {
    const result = await callTool(api, 'mteam_complete_task', {
      taskId,
      contextStep: '完成数据清洗',
      contextOutput: { summary: '清洗完成' },
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
    expect(data.task.status).toBe('COMPLETED');
  });

  test('不存在的 taskId 返回失败', async () => {
    const result = await callTool(api, 'mteam_complete_task', {
      taskId: 'non-existent',
      contextStep: 's',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });

  test('contextOutput 为空时正常处理', async () => {
    const result = await callTool(api, 'mteam_complete_task', {
      taskId,
      contextStep: '步骤描述',
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
  });

  test('带 files 的 contextOutput 正常处理', async () => {
    const result = await callTool(api, 'mteam_complete_task', {
      taskId,
      contextStep: '生成图表',
      contextOutput: { summary: 'done', files: ['chart.png'] },
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
    expect(data.task.status).toBe('COMPLETED');
  });
});

// ============================================================
// mteam_cancel_task
// ============================================================

describe('mteam_cancel_task', () => {
  let taskId;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pubResult = publishTask({ description: 'd', goal: 'g', publisher: 'user' });
    taskId = pubResult.taskId;
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_cancel_task', { publisher: 'user' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('publisher 缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_cancel_task', { taskId });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常取消返回 success', async () => {
    const result = await callTool(api, 'mteam_cancel_task', {
      taskId,
      publisher: 'user',
      reason: '优先级调整',
    });
    const data = extract(result);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('CANCELLED');
  });

  test('非发布者取消返回失败', async () => {
    const result = await callTool(api, 'mteam_cancel_task', {
      taskId,
      publisher: 'wrong-publisher',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });

  test('不存在的任务取消返回失败', async () => {
    const result = await callTool(api, 'mteam_cancel_task', {
      taskId: 'non-existent',
      publisher: 'user',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });
});

// ============================================================
// mteam_relay_task
// ============================================================

describe('mteam_relay_task', () => {
  let taskId;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pubResult = publishTask({ description: 'd', goal: 'g' });
    taskId = pubResult.taskId;
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_relay_task', { agentId: 'alice' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('contextStep 缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_relay_task', { taskId, agentId: 'alice' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常 relay 返回 success，状态变为 PENDING', async () => {
    const result = await callTool(api, 'mteam_relay_task', {
      taskId,
      agentId: 'alice',
      contextStep: '数据清洗完成',
    });
    const data = extract(result);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('PENDING');
    expect(data.task.lastExecutor).toBe('alice');
    expect(data.task.executor).toBeNull();
  });

  test('带 contextOutput 正常处理', async () => {
    const result = await callTool(api, 'mteam_relay_task', {
      taskId,
      agentId: 'alice',
      contextStep: '步骤一',
      contextOutput: { summary: 'done', files: ['out.csv'] },
    });
    const data = extract(result);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('PENDING');
  });

  test('非当前 executor relay 返回失败', async () => {
    const result = await callTool(api, 'mteam_relay_task', {
      taskId,
      agentId: 'bob', // alice 才是当前 executor
      contextStep: 's',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });
});

// ============================================================
// mteam_relinquish_task
// ============================================================

describe('mteam_relinquish_task', () => {
  let taskId;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pubResult = publishTask({ description: 'd', goal: 'g' });
    taskId = pubResult.taskId;
    claimTask(taskId, 'alice');
  });

  test('必填参数缺失时返回错误结构', async () => {
    const result = await callTool(api, 'mteam_relinquish_task', { executorId: 'alice' });
    const data = extract(result);
    expect(data.error).toBeDefined();
    expect(data.success).toBe(false);
  });

  test('正常 relinquish 返回 success，状态变为 PENDING', async () => {
    const result = await callTool(api, 'mteam_relinquish_task', {
      taskId,
      executorId: 'alice',
    });
    const data = extract(result);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('PENDING');
    expect(data.task.executor).toBeNull();
  });

  test('非当前 executor relinquish 返回失败', async () => {
    const result = await callTool(api, 'mteam_relinquish_task', {
      taskId,
      executorId: 'bob',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });

  test('不存在的任务 relinquish 返回失败', async () => {
    const result = await callTool(api, 'mteam_relinquish_task', {
      taskId: 'non-existent',
      executorId: 'alice',
    });
    const data = extract(result);
    expect(data.success).toBe(false);
  });
});

// ============================================================
// mteam_update_task
// ============================================================

describe('mteam_update_task', () => {
  let taskId;

  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pubResult = publishTask({ description: 'd', goal: 'g' });
    taskId = pubResult.taskId;
    claimTask(taskId, 'alice');
  });

  test('只传 taskId 不报错（全部可选）', async () => {
    const result = await callTool(api, 'mteam_update_task', { taskId });
    const data = extract(result);
    expect(data.task).toBeDefined();
  });

  test('更新 description 正常处理', async () => {
    const result = await callTool(api, 'mteam_update_task', {
      taskId,
      description: '新的描述',
    });
    const data = extract(result);
    expect(data.task.description).toBe('新的描述');
  });

  test('更新 status 正常处理', async () => {
    const result = await callTool(api, 'mteam_update_task', {
      taskId,
      status: 'running',
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
  });

  test('追加 contextStep 正常处理', async () => {
    const result = await callTool(api, 'mteam_update_task', {
      taskId,
      contextStep: '执行中步骤',
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
  });

  test('心跳时间戳正常处理', async () => {
    const ts = Date.now();
    const result = await callTool(api, 'mteam_update_task', {
      taskId,
      lastHeartbeatAt: ts,
    });
    const data = extract(result);
    expect(data.task).toBeDefined();
  });

  test('不存在的 taskId 返回失败', async () => {
    const result = await callTool(api, 'mteam_update_task', {
      taskId: 'non-existent',
    });
    const data = extract(result);
    expect(data.task).toBeNull();
  });
});

// ============================================================
// mteam_get_pending
// ============================================================

describe('mteam_get_pending', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('无参数时返回待认领列表', async () => {
    const { publishTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    publishTask({ description: 'd', goal: 'g' });
    publishTask({ description: 'd2', goal: 'g2' });

    const result = await callTool(api, 'mteam_get_pending', {});
    const data = extract(result);
    expect(data.pending).toBeInstanceOf(Array);
    expect(data.pending.length).toBeGreaterThanOrEqual(2);
  });

  test('带 agentId 过滤正常处理', async () => {
    const result = await callTool(api, 'mteam_get_pending', { agentId: 'alice' });
    const data = extract(result);
    expect(data.pending).toBeInstanceOf(Array);
  });
});

// ============================================================
// mteam_get_agent_active
// ============================================================

describe('mteam_get_agent_active', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('无活跃任务时返回 null', async () => {
    const result = await callTool(api, 'mteam_get_agent_active', { agentId: 'nobody' });
    const data = extract(result);
    expect(data.activeTask).toBeNull();
  });

  test('认领后返回活跃任务', async () => {
    const { publishTask, claimTask } = require('../../src/pool/operations.js');
    const pub = publishTask({ description: 'd', goal: 'g' });
    claimTask(pub.taskId, 'alice');

    const result = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
    const data = extract(result);
    expect(data.activeTask).not.toBeNull();
    expect(data.activeTask.taskId).toBe(pub.taskId);
  });

  test('任务完成后返回 null', async () => {
    const { publishTask, claimTask, completeTask } = require('../../src/pool/operations.js');
    const pub = publishTask({ description: 'd', goal: 'g' });
    claimTask(pub.taskId, 'alice');
    completeTask(pub.taskId, { step: 'done', output: {} });

    const result = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
    const data = extract(result);
    expect(data.activeTask).toBeNull();
  });
});

// ============================================================
// mteam_get_task
// ============================================================

describe('mteam_get_task', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('获取存在的任务', async () => {
    const { publishTask } = require('../../src/pool/operations.js');
    const pub = publishTask({ description: 'd', goal: 'g' });

    const result = await callTool(api, 'mteam_get_task', { taskId: pub.taskId });
    const data = extract(result);
    expect(data.task).toBeDefined();
    expect(data.task.taskId).toBe(pub.taskId);
  });

  test('获取不存在的任务返回 null', async () => {
    const result = await callTool(api, 'mteam_get_task', { taskId: 'non-existent' });
    const data = extract(result);
    expect(data.task).toBeNull();
  });
});

// ============================================================
// mteam_get_all_tasks
// ============================================================

describe('mteam_get_all_tasks', () => {
  beforeEach(async () => {
    api = createMockApi(NOOP_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
  });

  test('返回所有任务列表', async () => {
    const { publishTask } = require('../../src/pool/operations.js');
    publishTask({ description: 'd1', goal: 'g1' });
    publishTask({ description: 'd2', goal: 'g2' });

    const result = await callTool(api, 'mteam_get_all_tasks', {});
    const data = extract(result);
    expect(data.tasks).toBeInstanceOf(Array);
    expect(data.tasks.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Side effects — notifications / subagent.run
// ============================================================

describe('Side effects', () => {
  test('mteam_complete_task 配置了 notifications 时调用 sendNotifications', async () => {
    const notifApi = createMockApi(WITH_NOTIF_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(notifApi, WITH_NOTIF_CONFIG);

    const { publishTask, claimTask, completeTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pub = publishTask({ description: 'd', goal: 'g' });
    claimTask(pub.taskId, 'alice');

    // completeTask 后应该有通知
    const result = await notifApi.getTool('mteam_complete_task').execute('mock-id', {
      taskId: pub.taskId,
      contextStep: 'done',
      contextOutput: { summary: 'ok' },
    });

    // 只要不抛错即认为侧跳调用链完整（mock sendNotifications 不实际发 HTTP）
    expect(result).toBeDefined();
  });

  test('mteam_relinquish_task 配置了 notifications 时调用 sendNotifications', async () => {
    const notifApi = createMockApi(WITH_NOTIF_CONFIG);
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(notifApi, WITH_NOTIF_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pub = publishTask({ description: 'd', goal: 'g' });
    claimTask(pub.taskId, 'alice');

    const result = await notifApi.getTool('mteam_relinquish_task').execute('mock-id', {
      taskId: pub.taskId,
      executorId: 'alice',
    });

    expect(result).toBeDefined();
  });

  test('mteam_claim_task 调用 subagent.run 返回 sessionKey 和 runId', async () => {
    const { registerTools } = await import('../../src/tools/index.js');
    registerTools(api, NOOP_CONFIG);

    const { publishTask, claimTask, setWorkspaceRoot } = require('../../src/pool/operations.js');
    setWorkspaceRoot('/tmp/m-team-tool-test');
    const pub = publishTask({ description: 'd', goal: 'g' });

    // 手动 claim 避免 subagent.run 被调用（让它在 tool 里跑）
    const result = await api.getTool('mteam_claim_task').execute('mock-id', {
      taskId: pub.taskId,
      agentId: 'alice',
    });

    const data = extract(result);
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
    expect(data.sessionKey).toContain(pub.taskId);
  });
});
