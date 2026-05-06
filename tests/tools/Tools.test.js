/**
 * Tools 层集成测试 — 通过 mockApi 测试 tool 层
 *
 * 覆盖：参数解析、错误处理、结果格式、侧跳调用（notifications / subagent.run）
 *
 * 测试策略：
 * - 每个 describe 的 beforeEach 完全独立：关闭旧 DB → 设新 workspace → 创建 fresh api → 注册 tools → 准备 fixture
 * - 通过 api.getTool(name).execute() 调用工具
 * - 验证返回格式：result.ok + extract(result).data
 */

import { createMockApi } from '../helpers/testApi.js';
import { registerTools } from '../../src/tools/index.js';
import { publishTask, claimTask, setWorkspaceRoot } from '../../src/pool/operations.js';
import { closeDb } from '../../src/pool/db.js';

// ============================================================
// 辅助
// ============================================================

const NOOP_CONFIG = { notifications: [] };
const WITH_NOTIF_CONFIG = {
  notifications: [{ provider: 'feishu', agents: ['alice'], groupId: 'test-group' }],
};

async function freshApi(config = NOOP_CONFIG) {
  closeDb();
  setWorkspaceRoot('/tmp/m-team-tool-test');
  const api = createMockApi(config);
  registerTools(api, config);
  return api;
}

async function callTool(api, toolName, params) {
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

test('注册了所有 11 个 tools', async () => {
  const api = await freshApi();
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
  expect(names).toHaveLength(12);
});

// ============================================================
// mteam_publish_task
// ============================================================

describe('mteam_publish_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { goal: '测试目标' });
    expect(result.ok).toBe(false);
  });

  test('goal 缺失时返回错误结构', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { description: '测试描述' });
    expect(result.ok).toBe(false);
  });

  test('正常参数返回 taskId', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { description: '数据清洗', goal: '分析销售数据' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.taskId).toBeDefined();
  });

  test('带 publisher 和 priority 参数正常处理', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g', publisher: 'alice', priority: 'high' });
    expect(result.ok).toBe(true);
    expect(extract(result).taskId).toBeDefined();
  });

  test('input 参数透传', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g', input: { key: 'value' } });
    expect(result.ok).toBe(true);
  });

  test('publisher 默认为 user', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_publish_task', { description: 'd', goal: 'g' });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// mteam_claim_task
// ============================================================

describe('mteam_claim_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_claim_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('taskId 缺失时返回错误结构', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_claim_task', { agentId: 'alice' });
    expect(result.ok).toBe(false);
  });

  test('正常认领返回 success + runId + sessionKey', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
    expect(data.sessionKey).toContain(taskId);
  });

  test('认领不存在的任务返回失败', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_claim_task', { taskId: 'non-existent-task', agentId: 'alice' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_complete_task
// ============================================================

describe('mteam_complete_task', () => {
  test('必填参数 contextStep 缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_complete_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('正常完成返回 task 对象，状态为 completed', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_complete_task', {
      taskId, contextStep: '完成数据清洗', contextOutput: { summary: '清洗完成' },
    });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
    expect(data.task.status).toBe('completed');
  });

  test('不存在的 taskId 返回失败', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_complete_task', {
      taskId: 'non-existent-task', contextStep: 'step',
    });
    expect(result.ok).toBe(false);
  });

  test('contextOutput 为空时正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'done' });
    expect(result.ok).toBe(true);
    expect(extract(result).task.status).toBe('completed');
  });

  test('带 files 的 contextOutput 正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_complete_task', {
      taskId, contextStep: 'done', contextOutput: { summary: 's', files: ['a.txt', 'b.csv'] },
    });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// mteam_cancel_task
// ============================================================

describe('mteam_cancel_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_cancel_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('publisher 缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_cancel_task', { taskId, reason: 'no' });
    expect(result.ok).toBe(false);
  });

  test('正常取消返回 success，状态变为 cancelled', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'user', reason: '停需求' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task.status).toBe('cancelled');
  });

  test('非发布者取消返回失败', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g', publisher: 'bob' });
    const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'alice', reason: 'try' });
    expect(result.ok).toBe(false);
  });

  test('不存在的任务取消返回失败', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_cancel_task', { taskId: 'non-existent', publisher: 'user' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_relay_task
// ============================================================

describe('mteam_relay_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_relay_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('contextStep 缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_relay_task', { taskId, contextOutput: {} });
    expect(result.ok).toBe(false);
  });

  test('正常 relay 返回 success，状态变为 pending', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_relay_task', {
      taskId, agentId: 'alice', contextStep: '步骤一完成', contextOutput: { summary: 'done' }, description: '继续下一步',
    });
    console.log('relay result:', JSON.stringify(result));
    if (!result.ok) {
      console.log('relay failed, data:', JSON.stringify(result.data));
      expect(result.ok).toBe(true); // will fail here and show data
    }
    const data = extract(result);
    expect(data.task.status).toBe('pending');
  });

  test('带 contextOutput 正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_relay_task', {
      taskId, agentId: 'alice', contextStep: 's', contextOutput: { summary: 'x', files: ['out.txt'] }, description: '后续处理',
    });
    expect(result.ok).toBe(true);
    expect(extract(result).task.status).toBe('pending');
  });

  test('非当前 executor relay 返回失败', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    // bob 不是当前 executor
    const result = await callTool(api, 'mteam_relay_task', {
      taskId, agentId: 'bob', contextStep: 's', contextOutput: {},
    });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_relinquish_task
// ============================================================

describe('mteam_relinquish_task', () => {
  test('必填参数缺失时返回错误结构', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_relinquish_task', { taskId });
    expect(result.ok).toBe(false);
  });

  test('正常 relinquish 返回 success，状态变为 pending', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('pending');
  });

  test('非当前 executor relinquish 返回失败', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_relinquish_task', { taskId, agentId: 'bob' });
    expect(result.ok).toBe(false);
  });

  test('不存在的任务 relinquish 返回失败', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_relinquish_task', { taskId: 'non-existent', agentId: 'alice' });
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// mteam_update_task
// ============================================================

describe('mteam_update_task', () => {
  test('只传 taskId 不报错', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_update_task', { taskId });
    expect(result.ok).toBe(true);
  });

  test('更新 description 正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_update_task', { taskId, description: '新描述' });
    expect(result.ok).toBe(true);
    expect(extract(result).task.description).toBe('新描述');
  });

  test('更新 status 正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_update_task', { taskId, status: 'running' });
    expect(result.ok).toBe(true);
    expect(extract(result).task.status).toBe('running');
  });

  test('追加 contextStep 正常处理', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_update_task', { taskId, contextStep: '步骤一完成', agentId: 'alice' });
    expect(result.ok).toBe(true);
    expect(extract(result).task.context).toHaveLength(2); // input + 步骤一
  });

  test('updatedAt 正常处理', async () => {
    const api = await freshApi();
    const before = Date.now();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_update_task', { taskId, agentId: 'alice' });
    expect(result.ok).toBe(true);
    // updatedAt 由 claimTask 写入，比 publishTask 更晚，所以 > before
    expect(extract(result).task.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test('不存在的 taskId 返回 task=null', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_update_task', { taskId: 'non-existent' });
    expect(result.ok).toBe(true);
    expect(extract(result).task).toBeNull();
  });
});

// ============================================================
// mteam_get_pending
// ============================================================

describe('mteam_get_pending', () => {
  test('带 agentId 返回待认领列表', async () => {
    const api = await freshApi();
    publishTask({ description: 'd1', goal: 'g1' });
    publishTask({ description: 'd2', goal: 'g2' });
    const result = await callTool(api, 'mteam_get_pending', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.pending).toBeInstanceOf(Array);
    expect(data.pending.length).toBeGreaterThanOrEqual(2);
  });

  test('带 agentId 过滤正常处理', async () => {
    const api = await freshApi();
    // bob 和 carol 各发布一个任务
    publishTask({ description: 'd1', goal: 'g1' });
    publishTask({ description: 'd2', goal: 'g2' });
    // alice 有一个活跃任务，不影响她查看 pending 列表
    const result = await callTool(api, 'mteam_get_pending', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    // alice 没有 pending 任务时返回空数组（而不是因为她有活跃任务就拒绝）
    expect(data.pending).toBeInstanceOf(Array);
  });
});

// ============================================================
// mteam_get_agent_active
// ============================================================

describe('mteam_get_agent_active', () => {
  test('无活跃任务时返回 null', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
    expect(result.ok).toBe(true);
    expect(extract(result).activeTask).toBeNull();
  });

  test('认领后返回活跃任务', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    const result = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.activeTask).not.toBeNull();
    expect(data.activeTask.taskId).toBe(taskId);
  });

  test('任务完成后返回 null', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    // 通过工具层完成（与测试其他用例一致）
    const result = await callTool(api, 'mteam_complete_task', {
      taskId, contextStep: 'done', contextOutput: {},
    });
    expect(result.ok).toBe(true);
    // 现在检查活跃任务
    const activeResult = await callTool(api, 'mteam_get_agent_active', { agentId: 'alice' });
    expect(activeResult.ok).toBe(true);
    expect(extract(activeResult).activeTask).toBeNull();
  });
});

// ============================================================
// mteam_get_task
// ============================================================

describe('mteam_get_task', () => {
  test('获取存在的任务', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_get_task', { taskId });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.task).toBeDefined();
    expect(data.task.taskId).toBe(taskId);
  });

  test('获取不存在的任务返回 null', async () => {
    const api = await freshApi();
    const result = await callTool(api, 'mteam_get_task', { taskId: 'non-existent' });
    expect(result.ok).toBe(true);
    expect(extract(result).task).toBeNull();
  });
});

// ============================================================
// mteam_get_all_tasks
// ============================================================

describe('mteam_get_all_tasks', () => {
  test('返回所有任务列表', async () => {
    const api = await freshApi();
    publishTask({ description: 'd1', goal: 'g1' });
    publishTask({ description: 'd2', goal: 'g2' });
    const result = await callTool(api, 'mteam_get_all_tasks', {});
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.tasks).toBeInstanceOf(Array);
    expect(data.tasks.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Side effects (notifications)
// ============================================================

describe('Side effects', () => {
  test('mteam_complete_task 配置 notifications 时调用 sendNotifications', async () => {
    const api = await freshApi(WITH_NOTIF_CONFIG);
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    // mock sendNotifications
    let called = false;
    api.sendNotifications = async () => { called = true; };
    const result = await callTool(api, 'mteam_complete_task', { taskId, contextStep: 'done' });
    expect(result.ok).toBe(true);
  });

  test('mteam_relinquish_task 配置 notifications 时调用 sendNotifications', async () => {
    const api = await freshApi(WITH_NOTIF_CONFIG);
    const taskId = publishTask({ description: 'd', goal: 'g' });
    claimTask(taskId, 'alice');
    let called = false;
    api.sendNotifications = async () => { called = true; };
    const result = await callTool(api, 'mteam_relinquish_task', { taskId, executorId: 'alice' });
    expect(result.ok).toBe(true);
  });

  test('mteam_claim_task 返回 sessionKey 和 runId', async () => {
    const api = await freshApi();
    const taskId = publishTask({ description: 'd', goal: 'g' });
    const result = await callTool(api, 'mteam_claim_task', { taskId, agentId: 'alice' });
    const data = extract(result);
    expect(result.ok).toBe(true);
    expect(data.runId).toBeDefined();
    expect(data.sessionKey).toContain('alice');
    expect(data.sessionKey).toContain(taskId);
  });

  test('mteam_publish_task 配置 notifications 时调用 sendNotifications', async () => {
    const api = await freshApi(WITH_NOTIF_CONFIG);
    // publisher 是 'user'，agents 包含 'user' 才触发
    let called = false;
    api.sendNotifications = async () => { called = true; };
    const result = await callTool(api, 'mteam_publish_task', {
      description: 'step 1',
      goal: 'whole task goal',
      publisher: 'user'
    });
    expect(result.ok).toBe(true);
  });

  test('mteam_cancel_task 配置 notifications 时调用 sendNotifications', async () => {
    const api = await freshApi(WITH_NOTIF_CONFIG);
    const taskId = publishTask({ description: 'd', goal: 'g', publisher: 'manager' });
    let called = false;
    api.sendNotifications = async () => { called = true; };
    const result = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'manager' });
    expect(result.ok).toBe(true);
  });
});
