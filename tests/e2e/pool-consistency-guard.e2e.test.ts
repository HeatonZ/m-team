import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, type ToolResult } from '../helpers/extract-tool-result.ts';
import { getTask, nextTask } from '../../src/pool/index.js';

describe('pool consistency guard e2e', () => {
  test('setTaskState throws when task.json diverges from DB snapshot', async () => {
    const harness = await createPluginHarness({ dashboardEnabled: false });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'Verify DB and task.json consistency checks',
        description: 'Create task for consistency verification',
        taskType: 'general',
        publisher: 'manager',
      }) as ToolResult<{ taskId: string }>;
      const taskId = extractDetails(publishResult)!.taskId;

      await harness.exec('mteam_claim_task', { taskId, agentId: 'maker' }, { agentId: 'maker' });

      const taskJsonPath = path.join(harness.workspace.tasksDir, taskId, 'task.json');
      const raw = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8')) as Record<string, unknown>;
      raw.status = 'failed';
      fs.writeFileSync(taskJsonPath, JSON.stringify(raw, null, 2), 'utf8');

      expect(() => nextTask(
        taskId,
        'maker',
        {
          step: 'Advance baton',
          output: {
            summary: 'step done',
          },
        },
        'Continue with next baton',
      )).toThrow('TASK_DB_JSON_INCONSISTENT');

      const logs = harness.readLogs(taskId, 'consistency_guard');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]?.error).toContain('TASK_DB_JSON_INCONSISTENT');

      const task = getTask(taskId);
      expect(task?.status).toBe('running');
    } finally {
      await harness.cleanup();
    }
  });
});
