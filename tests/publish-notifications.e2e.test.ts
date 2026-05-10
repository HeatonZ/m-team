import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { createPluginHarness } from './helpers/create-plugin-harness.ts';
import { extractDetails } from './helpers/extract-tool-result.ts';

describe('publish notification observability', () => {
  it('records successful publish notification delivery in runtime logs', async () => {
    const harness = await createPluginHarness({
      notifications: [{
        provider: 'feishu',
        groupId: 'oc_test_group',
        appId: 'test_app_id',
        appSecret: 'test_app_secret',
        agents: ['manager'],
      }],
    });

    const authScope = nock('https://open.feishu.cn')
      .post('/open-apis/auth/v3/tenant_access_token/internal')
      .reply(200, { code: 0, msg: 'ok', tenant_access_token: 'tenant_token' });

    const sendScope = nock('https://open.feishu.cn')
      .post('/open-apis/im/v1/messages?receive_id_type=chat_id')
      .reply(200, { code: 0, msg: 'ok' });

    try {
      const result = await harness.exec('mteam_publish_task', {
        goal: '验证通知成功日志',
        description: '只发布并验证日志',
        publisher: 'manager',
      }, { agentId: 'manager' });

      expect(extractDetails(result as { details?: { taskId?: string } })?.taskId).toBeTruthy();
      expect(authScope.isDone()).toBe(true);
      expect(sendScope.isDone()).toBe(true);

      const logs = harness.readRuntimeLogs();
      expect(logs.some((entry) => entry.message.includes('notification delivered provider=feishu target=oc_test_group'))).toBe(true);
      expect(logs.some((entry) => entry.message.includes('publish notifications prepared=1 delivered=1'))).toBe(true);
    } finally {
      nock.cleanAll();
      await harness.cleanup();
    }
  });

  it('records skipped publish notification when credentials are missing', async () => {
    const harness = await createPluginHarness({
      notifications: [{
        provider: 'feishu',
        groupId: 'oc_test_group',
        agents: ['manager'],
      }],
    });

    try {
      const result = await harness.exec('mteam_publish_task', {
        goal: '验证通知跳过日志',
        description: '只发布并验证缺凭证跳过',
        publisher: 'manager',
      }, { agentId: 'manager' });

      expect(extractDetails(result as { details?: { taskId?: string } })?.taskId).toBeTruthy();

      const logs = harness.readRuntimeLogs();
      expect(logs.some((entry) => entry.message.includes('notification skipped provider=feishu target=oc_test_group reason=missing-credentials'))).toBe(true);
      expect(logs.some((entry) => entry.message.includes('publish notifications prepared=1 delivered=0'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
