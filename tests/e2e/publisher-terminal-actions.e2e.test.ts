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
        goal: 'Create a task that can be cancelled',
        description: 'Create a cancellable test task',
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
        goal: 'Produce a final file that can be accepted',
        description: 'Generate the final result file',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const closeTaskId = extractDetails(closePublish)!.taskId;
      await harness.exec('mteam_claim_task', { taskId: closeTaskId, agentId: 'maker' });
      harness.mutateTask(closeTaskId, (task) => {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.updatedAt = task.completedAt;
        task.executor = null;
        task.lastExecutor = 'maker';
      });
      const closeResult = await harness.exec('mteam_close_task', {
        taskId: closeTaskId,
        publisher: 'manager',
      }) as ToolResult<{ success: boolean; task?: Record<string, unknown> }>;
      expect(extractDetails(closeResult)?.success).toBe(true);
      expect(harness.readTask(closeTaskId)?.status).toBe('closed');

      const rejectPublish = await harness.exec('mteam_publish_task', {
        goal: 'Produce a report that can be revised after review',
        description: 'Generate a candidate report for review',
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
        goal: 'Verify publisher permission boundaries',
        description: 'Create a task restricted to manager approval',
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
        goal: 'Verify heartbeat cannot publish tasks',
        description: 'Record a heartbeat publish attempt',
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
        goal: 'Verify publish ownership mismatch auditing',
        description: 'Record a publish with mismatched explicit publisher and hook context',
        publisher: 'manager',
      });
      registerAfterToolCallHook({
        on(hookName: 'after_tool_call', handler: unknown) {
          if (hookName === 'after_tool_call') {
            (handler as (event: unknown, ctx: unknown) => void)({
              toolName: 'mteam_publish_task',
              params: {
                goal: 'Verify publish ownership mismatch auditing',
                description: 'Record a publish with mismatched explicit publisher and hook context',
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
