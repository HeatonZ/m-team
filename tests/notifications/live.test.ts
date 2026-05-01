/**
 * tests/notifications/live.test.ts
 *
 * 通知发送端到端测试 — 验证 sendNotifications 产生的真实 HTTP 调用
 *
 * 通过 mock globalThis.fetch 拦截 Feishu/Discord API 请求，
 * 验证：消息内容、接收人、Authorization header、credential 字段。
 *
 * 环境变量：
 *   MTEAM_TEST_FEISHU_APP_ID      Feishu app_id
 *   MTEAM_TEST_FEISHU_APP_SECRET   Feishu app_secret
 *   MTEAM_TEST_FEISHU_CHAT_ID     目标群 ID（open_id）
 *   MTEAM_TEST_DISCORD_CHANNEL_ID  Discord channel ID
 *   MTEAM_TEST_DISCORD_TOKEN      Discord bot token
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../helpers/testApi.js';
import { closeDb } from '../../src/pool/db.js';
import { registerTools } from '../../src/tools/index.js';
import { setWorkspaceRoot, publishTask } from '../../src/pool/operations.js';
import {
  formatPublishNotifications,
  formatClaimNotifications,
  formatCancelNotifications,
  setNotifications,
} from '../../src/notifications.js';

// ─── 常量（从环境变量读取，测试时需在 .env 或 CI 设置） ────────────────────────
// MTEAM_TEST_FEISHU_APP_ID=cli_xxx
// MTEAM_TEST_FEISHU_APP_SECRET=xxx
// MTEAM_TEST_FEISHU_CHAT_ID=oc_xxx
// MTEAM_TEST_DISCORD_CHANNEL_ID=123456
// MTEAM_TEST_DISCORD_TOKEN=Bot xxx

const FEISHU_APP_ID = process.env.MTEAM_TEST_FEISHU_APP_ID ?? '';
const FEISHU_APP_SECRET = process.env.MTEAM_TEST_FEISHU_APP_SECRET ?? '';
const FEISHU_CHAT_ID = process.env.MTEAM_TEST_FEISHU_CHAT_ID ?? '';
const DISCORD_CHANNEL_ID = process.env.MTEAM_TEST_DISCORD_CHANNEL_ID ?? '';
const DISCORD_TOKEN = process.env.MTEAM_TEST_DISCORD_TOKEN ?? '';

// ─── Fetch mock factory ────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function createFetchMock() {
  const calls: FetchCall[] = [];

  const mockFetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k, String(v)])
      ),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    // Feishu token 申请
    if (url.includes('auth/v3/tenant_access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, msg: 'ok', tenant_access_token: 'mock_feishu_token' }),
      } as unknown as Response;
    }

    // Feishu 发消息
    if (url.includes('/im/v1/messages')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, msg: 'ok', data: { message_id: 'mock_msg_id' } }),
      } as unknown as Response;
    }

    // Discord 发消息
    if (url.includes('/api/v10/channels/') && url.includes('/messages')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'mock_discord_msg_id' }),
      } as unknown as Response;
    }

    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });

  return { calls, mockFetch };
}

// ─── 辅助 ───────────────────────────────────────────────────

async function freshApi(notifConfig: object) {
  closeDb();
  setWorkspaceRoot('/tmp/m-team-live-test');
  const api = createMockApi({ notifications: notifConfig }) as Record<string, unknown>;
  api.logger = { info() {}, warn() {}, error() {}, debug() {} };
  registerTools(api as Parameters<typeof registerTools>[0], notifConfig as Parameters<typeof registerTools>[1]);
  return api;
}

async function callTool(api: Record<string, unknown>, toolName: string, params: Record<string, unknown>) {
  const toolGetter = api.getTool as (n: string) => { execute: (id: string, p: object) => Promise<unknown> } | undefined;
  const tool = toolGetter?.(toolName);
  if (!tool) throw new Error(`Tool not found: ${toolName}`);
  return tool.execute('mock-call-id', params);
}

function extract(result: { ok: boolean; data: unknown }) {
  return result.data;
}

// ─── Tests ─────────────────────────────────────────────────

describe('通知发送端到端', () => {

  describe('publish task 通知', () => {
    it('调用 fetch 发 Feishu 消息，消息包含任务信息', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'feishu',
          agents: ['manager'],
          groupId: FEISHU_CHAT_ID,
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'feishu',
        agents: ['manager'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      }]);

      const result = await callTool(api, 'mteam_publish_task', {
        description: '数据清洗任务',
        goal: '分析销售数据并生成报告',
        publisher: 'manager',
        priority: 'high',
      });

      expect(result).toMatchObject({ ok: true });
      // 两条 fetch：1. token 申请  2. 发消息
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const msgCall = calls.find(c => c.url.includes('/im/v1/messages'));
      expect(msgCall).toBeDefined();
      expect(msgCall!.body.content).toContain('数据清洗任务');
      expect(msgCall!.body.content).toContain('分析销售数据并生成报告');
      expect(msgCall!.body.content).toContain('high');
      expect(msgCall!.headers['Authorization']).toBe('Bearer mock_feishu_token');
    });

    it('publisher 不在 agents 列表时不发请求', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'feishu',
          agents: ['alice'],
          groupId: FEISHU_CHAT_ID,
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'feishu',
        agents: ['alice'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      }]);

      await callTool(api, 'mteam_publish_task', {
        description: 'd',
        goal: 'g',
        publisher: 'manager', // 不在 agents 列表
      });

      // 没有触发任何 fetch（publisher 不匹配，不过通知）
      const msgCalls = calls.filter(c => c.url.includes('/im/v1/messages'));
      expect(msgCalls).toHaveLength(0);
    });

    it('normal 优先级显示在消息中', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'feishu',
          agents: ['manager'],
          groupId: FEISHU_CHAT_ID,
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'feishu',
        agents: ['manager'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      }]);

      await callTool(api, 'mteam_publish_task', {
        description: '普通任务',
        goal: 'goal',
        publisher: 'manager',
        priority: 'normal',
      });

      const msgCall = calls.find(c => c.url.includes('/im/v1/messages'));
      expect(msgCall).toBeDefined();
      expect(msgCall!.body.content).toContain('normal');
    });

    it('Discord 通知走 Discord API', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'discord',
          agents: ['manager'],
          channelId: DISCORD_CHANNEL_ID,
          discordToken: DISCORD_TOKEN,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'discord',
        agents: ['manager'],
        channelId: DISCORD_CHANNEL_ID,
        discordToken: DISCORD_TOKEN,
      }]);

      await callTool(api, 'mteam_publish_task', {
        description: 'Discord测试任务',
        goal: 'goal',
        publisher: 'manager',
      });

      const msgCall = calls.find(c => c.url.includes('/api/v10/channels/'));
      expect(msgCall).toBeDefined();
      expect(msgCall!.url).toContain(DISCORD_CHANNEL_ID);
      expect(msgCall!.headers['Authorization']).toBe(`Bot ${DISCORD_TOKEN}`);
      expect(msgCall!.body.content).toContain('Discord测试任务');
    });
  });

  describe('cancel task 通知', () => {
    it('发送取消通知', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'feishu',
          agents: ['manager'],
          groupId: FEISHU_CHAT_ID,
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'feishu',
        agents: ['manager'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      }]);

      const pubResult = await callTool(api, 'mteam_publish_task', {
        description: '待取消任务',
        goal: '目标',
        publisher: 'manager',
      });
      const taskId = (extract(pubResult as { ok: boolean; data: unknown }) as { taskId: string }).taskId;

      const cancelResult = await callTool(api, 'mteam_cancel_task', { taskId, publisher: 'manager' });
      expect(cancelResult).toMatchObject({ ok: true });

      // 找取消那条消息（最后一条 /im/v1/messages）
      const msgCalls = calls.filter(c => c.url.includes('/im/v1/messages'));
      const cancelCall = msgCalls[msgCalls.length - 1];
      expect(cancelCall.body.content).toContain('取消');
      expect(cancelCall.body.content).toContain('manager');
    });
  });

  describe('relay / relinquish 通知', () => {
    it('relay 触发通知', async () => {
      const { calls, mockFetch } = createFetchMock();
      vi.stubGlobal('fetch', mockFetch);

      const notifConfig = {
        notifications: [{
          provider: 'feishu',
          agents: ['executor1'],
          groupId: FEISHU_CHAT_ID,
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
        }],
      };
      const api = await freshApi(notifConfig);
      setNotifications([{
        provider: 'feishu',
        agents: ['executor1'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      }]);

      const pubResult = await callTool(api, 'mteam_publish_task', {
        description: '中转任务',
        goal: '目标',
        publisher: 'manager',
      });
      const taskId = (extract(pubResult as { ok: boolean; data: unknown }) as { taskId: string }).taskId;

      // claim
      await callTool(api, 'mteam_claim_task', { taskId, agentId: 'executor1' });
      const relayResult = await callTool(api, 'mteam_relay_task', {
        taskId,
        agentId: 'executor1',
        contextStep: '第一步完成，等待下一步',
      });
      expect(relayResult).toMatchObject({ ok: true });

      const msgCalls = calls.filter(c => c.url.includes('/im/v1/messages'));
      const relayCall = msgCalls[msgCalls.length - 1];
      expect(relayCall.body.content).toMatch(/交接|放回池子/);
    });
  });

  describe('format 函数单元验证', () => {
    it('formatPublishNotifications 输出符合预期（含 credentials）', () => {
      const task = {
        id: 'task_1',
        goal: '测试目标',
        description: '测试描述',
        publisher: 'manager',
        priority: 'high' as const,
        status: 'pending' as const,
        context: [],
        createdAt: Date.now(),
      };
      const cfg = {
        provider: 'feishu' as const,
        agents: ['manager'],
        groupId: FEISHU_CHAT_ID,
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
      };
      setNotifications([cfg]);
      const notifications = formatPublishNotifications(task, [cfg]);

      expect(notifications).toHaveLength(1);
      expect(notifications[0].provider).toBe('feishu');
      expect(notifications[0].chatId).toBe(FEISHU_CHAT_ID);
      expect(notifications[0].appId).toBe(FEISHU_APP_ID);
      expect(notifications[0].appSecret).toBe(FEISHU_APP_SECRET);
      expect(notifications[0].message).toContain('测试目标');
      expect(notifications[0].message).toContain('测试描述');
      expect(notifications[0].message).toContain('high');
    });

    it('formatClaimNotifications 输出符合预期', () => {
      const task = {
        id: 'task_1',
        goal: '测试目标',
        description: '测试描述',
        executor: 'alice',
        status: 'running' as const,
        context: [],
        createdAt: Date.now(),
      };
      const notifications = formatClaimNotifications(task, [
        { provider: 'feishu', agents: ['alice'], groupId: FEISHU_CHAT_ID, appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET },
      ]);

      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain('alice');
      expect(notifications[0].message).toContain('测试目标');
    });

    it('formatCancelNotifications 输出符合预期', () => {
      const task = {
        id: 'task_1',
        goal: '测试目标',
        description: '测试描述',
        publisher: 'manager',
        status: 'cancelled' as const,
        context: [],
        createdAt: Date.now(),
      };
      const notifications = formatCancelNotifications(task, [
        { provider: 'feishu', agents: ['manager'], groupId: FEISHU_CHAT_ID, appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET },
      ]);

      expect(notifications).toHaveLength(1);
      expect(notifications[0].message).toContain('取消');
      expect(notifications[0].message).toContain('manager');
    });

    it('Discord 格式化含 discordToken', () => {
      const task = {
        id: 'task_1',
        goal: '测试目标',
        description: '测试描述',
        publisher: 'manager',
        priority: 'normal' as const,
        status: 'pending' as const,
        context: [],
        createdAt: Date.now(),
      };
      const notifications = formatPublishNotifications(task, [
        { provider: 'discord', agents: ['manager'], channelId: DISCORD_CHANNEL_ID, discordToken: DISCORD_TOKEN },
      ]);

      expect(notifications).toHaveLength(1);
      expect(notifications[0].discordToken).toBe(DISCORD_TOKEN);
      expect(notifications[0].channelId).toBe(DISCORD_CHANNEL_ID);
    });
  });
});
