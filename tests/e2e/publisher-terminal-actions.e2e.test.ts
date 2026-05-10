import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';
import { registerAfterToolCallHook } from '../../src/hooks/afterToolCall.ts';
import { publishTask } from '../../src/pool/index.js';

interface PublishDetails {
  taskId: string;
}

describe('publisher terminal actions e2e', () => {
  test('supports cancel, close, and reject flows for publisher-facing tools', async () => {
    const harness = await createPluginHarness();
    try {
      const cancelPublish = await harness.exec('mteam_publish_task', {
        goal: '准备取消测试任务',
        description: '生成一个可取消任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const cancelTaskId = extractDetails(cancelPublish)!.taskId;

      const cancelResult = await harness.exec('mteam_cancel_task', {
        taskId: cancelTaskId,
        publisher: 'manager',
        reason: '需求取消',
      }) as ToolResult<{ success: boolean; task?: Record<string, unknown> }>;
      expect(extractDetails(cancelResult)?.success).toBe(true);
      expect(harness.readTask(cancelTaskId)?.status).toBe('cancelled');

      const closePublish = await harness.exec('mteam_publish_task', {
        goal: '准备验收关闭任务',
        description: '生成一个待关闭任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const closeTaskId = extractDetails(closePublish)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: closeTaskId, agentId: 'maker' });
      harness.mutateTask(closeTaskId, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.lifecycle.phase = 'finalizing';
      });
      const closeResult = await harness.exec('mteam_close_task', {
        taskId: closeTaskId,
        publisher: 'manager',
      }) as ToolResult<{ success: boolean; task?: Record<string, unknown> }>;
      expect(extractDetails(closeResult)?.success).toBe(true);
      expect(harness.readTask(closeTaskId)?.status).toBe('closed');

      const rejectPublish = await harness.exec('mteam_publish_task', {
        goal: '准备驳回任务',
        description: '生成一个待驳回任务',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const rejectTaskId = extractDetails(rejectPublish)!.taskId;
      const rejectResult = await harness.exec('mteam_reject_task', {
        taskId: rejectTaskId,
        reason: '验收驳回：输出不完整。下一步：补齐缺失字段并重新提交',
      }) as ToolResult<{ task?: Record<string, unknown> }>;
      expect(extractText(rejectResult)).toContain('任务已驳回');
      const rejectedTask = harness.readTask(rejectTaskId);
      expect(rejectedTask?.status).toBe('pending');
      expect(rejectedTask?.description).toBe('补齐缺失字段并重新提交');
      expect(rejectedTask?.context.at(-1)?.step).toContain('验收驳回');
    } finally {
      await harness.cleanup();
    }
  });

  test('rejects publisher-facing actions when caller is not the real publisher in main session', async () => {
    const harness = await createPluginHarness();
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: '验证 publisher 权限链',
        description: '生成一个只能由 manager 操作的任务',
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:main',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const cancelBlocked = await harness.exec('mteam_cancel_task', {
        taskId,
        publisher: 'manager',
        reason: 'maker 越权取消',
      }, {
        agentId: 'maker',
        sessionKey: 'agent:maker:main',
      }) as ToolResult<{ blocked?: boolean; reason?: string }>;
      expect(extractDetails(cancelBlocked)?.blocked).toBe(true);
      expect(extractText(cancelBlocked)).toContain('publisher=manager');
      expect(harness.readTask(taskId)?.status).toBe('pending');
    } finally {
      await harness.cleanup();
    }
  });

  test('blocks heartbeat session from publishing new tasks', async () => {
    const harness = await createPluginHarness();
    try {
      const blocked = await harness.exec('mteam_publish_task', {
        goal: 'heartbeat 禁止发布',
        description: '不应成功创建任务',
      }, {
        agentId: 'manager',
        sessionKey: 'agent:manager:main:heartbeat',
      }) as ToolResult<{ blocked?: boolean; reason?: string }>;

      expect(extractDetails(blocked)?.blocked).toBe(true);
      expect(extractText(blocked)).toContain('heartbeat');
      expect(harness.readRuntimeLogs().some((entry) => entry.message.includes('任务发布'))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  test('emits ownership mismatch audit when hook ctx and persisted publisher diverge', async () => {
    const harness = await createPluginHarness();
    try {
      const logRecords: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
      const taskId = publishTask({
        goal: '验证 publish ownership mismatch 审计',
        description: '显式 publisher 与 hook ctx 故意不一致',
        publisher: 'manager',
      });
      registerAfterToolCallHook({
        on(hookName: 'after_tool_call', handler: unknown) {
          if (hookName === 'after_tool_call') {
            (handler as (event: unknown, ctx: unknown) => void)({
              toolName: 'mteam_publish_task',
              params: {
                goal: '验证 publish ownership mismatch 审计',
                description: '显式 publisher 与 hook ctx 故意不一致',
                publisher: 'manager',
              },
              result: { details: { taskId } },
            }, {
              agentId: 'maker',
              sessionKey: 'agent:maker:main',
            });
          }
        },
        logger: {
          info() {},
          warn() {},
          error(message: string) { logRecords.push({ level: 'error', message }); },
        },
      } as never);

      expect(logRecords.some((entry) => entry.message.includes(`publish ownership mismatch taskId=${taskId}`))).toBe(true);
      expect(logRecords.some((entry) => entry.message.includes('taskPublisher=manager'))).toBe(true);
      expect(logRecords.some((entry) => entry.message.includes('contextAgentId=maker'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
