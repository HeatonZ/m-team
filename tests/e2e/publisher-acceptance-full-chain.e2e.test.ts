import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('publisher acceptance full chain e2e', () => {
  test('publisher can close a completed task after agent_end marks it completed', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Produce the final candidate conclusion',
        description: 'Generate the final result file',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: 'goal satisfied',
        summary: 'final artifact ready',
        confidence: 'high',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: `Final output: /mnt/d/code/m-team/tasks/${taskId}/final-result.md` }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      harness.mutateTask(taskId, (task) => {
        const last = task.context.at(-1);
        if (!last || last.type !== 'step') return;
        last.output = {
          ...(last.output ?? {}),
          files: [`/mnt/d/code/m-team/tasks/${taskId}/final-result.md`],
        };
        task.acceptance = {
          taskDir: `/mnt/d/code/m-team/tasks/${taskId}`,
          summary: 'final artifact ready',
          files: [`/mnt/d/code/m-team/tasks/${taskId}/final-result.md`],
          updatedAt: Date.now(),
          source: 'agent_end',
        };
      });

      expect(harness.readTask(taskId)?.status).toBe('completed');
      expect(harness.runHeartbeat('manager')?.appendContext).toContain('COMPLETED');

      await harness.exec(
        'mteam_get_task_for_publisher',
        { taskId },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      );
      const guardApi = harness.api;
      for (const hook of guardApi.__hooks.before_tool_call) {
        hook({
          toolName: 'read',
          params: { path: `/mnt/d/code/m-team/tasks/${taskId}/final-result.md` },
        } as never, {
          sessionKey: 'agent:manager:discord:heartbeat',
        } as never);
      }

      const closeResult = await harness.exec(
        'mteam_close_task',
        { taskId, publisher: 'manager' },
        { sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success: boolean }>;

      expect(extractDetails(closeResult)?.success).toBe(true);
      expect(harness.readTask(taskId)?.status).toBe('closed');
    } finally {
      await harness.cleanup();
    }
  });

  test('publisher can reject a completed task and send it back to pending with next step', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Produce a candidate report with enough evidence',
        description: 'Generate the candidate report',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'complete',
        reason: 'executor marked complete',
        summary: 'candidate report submitted',
        confidence: 'medium',
      });

      await harness.runAgentEnd(
        {
          success: true,
          messages: [{ role: 'assistant', content: `Final output: /mnt/d/code/m-team/tasks/${taskId}/candidate-report.md` }],
        } as never,
        { agentId: 'maker', sessionKey: `agent:maker:m-team:${taskId}:test-session` },
      );

      harness.mutateTask(taskId, (task) => {
        const last = task.context.at(-1);
        if (!last || last.type !== 'step') return;
        last.output = {
          ...(last.output ?? {}),
          files: [`/mnt/d/code/m-team/tasks/${taskId}/candidate-report.md`],
        };
        task.acceptance = {
          taskDir: `/mnt/d/code/m-team/tasks/${taskId}`,
          summary: 'candidate report submitted',
          files: [`/mnt/d/code/m-team/tasks/${taskId}/candidate-report.md`],
          updatedAt: Date.now(),
          source: 'agent_end',
        };
      });

      expect(harness.readTask(taskId)?.status).toBe('completed');

      await harness.exec(
        'mteam_get_task_for_publisher',
        { taskId },
        { agentId: 'manager', sessionKey: 'agent:manager:discord:heartbeat' },
      );
      const guardApi = harness.api;
      for (const hook of guardApi.__hooks.before_tool_call) {
        hook({
          toolName: 'read',
          params: { path: `/mnt/d/code/m-team/tasks/${taskId}/candidate-report.md` },
        } as never, {
          sessionKey: 'agent:manager:discord:heartbeat',
        } as never);
      }

      const rejectResult = await harness.exec(
        'mteam_reject_task',
        {
          taskId,
          publisher: 'manager',
          reason: 'missing pricing comparison evidence',
          description: 'add pricing comparison screenshots and resubmit report',
        },
        { sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ task?: Record<string, unknown> }>;

      expect(extractDetails(rejectResult)?.task).toBeTruthy();
      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.description).toBe('add pricing comparison screenshots and resubmit report');
      expect(task?.context.at(-1)?.step).toContain('missing pricing comparison evidence');
    } finally {
      await harness.cleanup();
    }
  });

  test('publisher heartbeat timeout path can relinquish stale running task before acceptance', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Recover stale executor work and return the task to the pool safely',
        description: 'Record a step that becomes stale after execution starts',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;
      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      harness.mutateTask(taskId, task => {
        task.updatedAt = Date.now() - 2 * 60 * 60 * 1000;
      });

      expect(harness.runHeartbeat('manager')?.appendContext).toContain('1 hour');

      const relinquishResult = await harness.exec(
        'mteam_relinquish_task',
        { taskId, reason: 'timeout return to pending' },
        { sessionKey: 'agent:manager:discord:heartbeat' },
      ) as ToolResult<{ success: boolean }>;

      expect(extractDetails(relinquishResult)?.success).toBe(true);
      const task = harness.readTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.executor).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });
});
