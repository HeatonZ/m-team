import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';

describe('task logs query e2e', () => {
  test('supports advanced dashboard log filters and decision summary', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });

    try {
      (harness.api as unknown as { runtime: { agentEndJudge: Function } }).runtime.agentEndJudge = async () => ({
        decision: 'next',
        reason: 'Need one more step to finish validation',
        nextDescription: 'Validate edge-case records and report evidence',
        nextTaskType: 'data',
        confidence: 'high',
      });

      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Finish one data validation loop',
        description: 'Draft validation checklist',
        taskType: 'data',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;

      const taskId = extractDetails(publishResult)?.taskId;
      expect(taskId).toBeTruthy();

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      await harness.runAgentEnd({
        success: true,
        messages: [{
          role: 'assistant',
          content: 'Validation checklist is ready at /mnt/d/workspace/m-team/tasks/checklist.md and needs one more edge-case pass.',
        }],
      } as never, {
        agentId: 'maker',
        sessionKey: `agent:maker:m-team:${taskId}:test-session`,
      });

      const logsAll = harness.readLogs(taskId);
      const nextLog = logsAll.find((entry) => entry.action === 'next');
      expect(nextLog).toBeTruthy();
      expect(nextLog?.decision).toMatchObject({
        decision: 'next',
        via: 'llm',
        reason: 'Need one more step to finish validation',
        nextTaskType: 'data',
        llmStatus: 'ok',
      });

      const dbMod = await import('../../src/pool/db.ts');
      const filteredByAgent = dbMod.getTaskLogs(undefined, undefined, 20, 0, { agentId: 'maker' });
      expect(filteredByAgent.some((log) => log.taskId === taskId)).toBe(true);

      const filteredByDecision = dbMod.getTaskLogs(undefined, undefined, 20, 0, {
        decision: 'next',
        via: 'llm',
        llmStatus: 'ok',
        keyword: 'edge-case',
      });
      expect(filteredByDecision.some((log) => log.taskId === taskId)).toBe(true);

      const countWithError = dbMod.countTaskLogs(undefined, undefined, { hasError: true });
      expect(countWithError).toBeGreaterThanOrEqual(0);
    } finally {
      await harness.cleanup();
    }
  });
});
