import { describe, expect, test } from 'vitest';
import { createPluginHarness } from '../helpers/create-plugin-harness.ts';
import { extractDetails, extractText, type ToolResult } from '../helpers/extract-tool-result.ts';

interface PublishDetails {
  taskId: string;
}

describe('claim routing e2e', () => {
  test('filters pending list by taskType -> agent route', async () => {
    const harness = await createPluginHarness({
      dashboardEnabled: false,
      claimRouting: {
        taskTypeAgents: {
          research: ['scholar'],
          coding: ['maker', 'fixer'],
        },
      },
    });
    try {
      await harness.exec('mteam_publish_task', {
        goal: 'research goal',
        description: 'collect references',
        taskType: 'research',
        publisher: 'manager',
      });
      await harness.exec('mteam_publish_task', {
        goal: 'coding goal',
        description: 'implement one function',
        taskType: 'coding',
        publisher: 'manager',
      });

      const pendingScholar = await harness.exec('mteam_get_pending', { agentId: 'scholar' }) as ToolResult<{ pending?: Array<{ taskType?: string }> }>;
      const pendingMaker = await harness.exec('mteam_get_pending', { agentId: 'maker' }) as ToolResult<{ pending?: Array<{ taskType?: string }> }>;

      const scholarList = extractDetails(pendingScholar)?.pending ?? [];
      const makerList = extractDetails(pendingMaker)?.pending ?? [];

      expect(scholarList.length).toBe(1);
      expect(scholarList[0]?.taskType).toBe('research');
      expect(makerList.length).toBe(1);
      expect(makerList[0]?.taskType).toBe('coding');
    } finally {
      await harness.cleanup();
    }
  });

  test('claim rejects when agent does not match taskType route', async () => {
    const harness = await createPluginHarness({
      dashboardEnabled: false,
      claimRouting: {
        taskTypeAgents: {
          research: ['scholar'],
        },
      },
    });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'research goal',
        description: 'collect references',
        taskType: 'research',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'maker',
      }) as ToolResult<{ success?: boolean; reason?: string }>;

      const text = extractText(claimResult);
      const details = extractDetails(claimResult);

      expect(text).toContain('AGENT_TASKTYPE_ROUTE_MISMATCH');
      expect(details?.success).toBe(false);
      expect(details?.reason).toContain('AGENT_TASKTYPE_ROUTE_MISMATCH');
    } finally {
      await harness.cleanup();
    }
  });

  test('claim routing is case-insensitive for agentId', async () => {
    const harness = await createPluginHarness({
      dashboardEnabled: false,
      claimRouting: {
        taskTypeAgents: {
          research: ['scholar'],
        },
      },
    });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'research goal',
        description: 'collect references',
        taskType: 'research',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'Scholar',
      }) as ToolResult<{ success?: boolean }>;

      expect(extractDetails(claimResult)?.success).toBe(true);
      const task = harness.readTask(taskId);
      expect(task?.status).toBe('running');
      expect(task?.executor).toBe('Scholar');
    } finally {
      await harness.cleanup();
    }
  });

  test('denyUnroutedTaskTypes blocks claim for unrouted non-general taskType', async () => {
    const harness = await createPluginHarness({
      dashboardEnabled: false,
      claimRouting: {
        taskTypeAgents: {
          research: ['scholar'],
        },
        denyUnroutedTaskTypes: true,
      },
    });
    try {
      const publishResult = await harness.exec('mteam_publish_task', {
        goal: 'ops goal',
        description: 'process one ops action',
        taskType: 'ops',
        publisher: 'manager',
      }) as ToolResult<PublishDetails>;
      const taskId = extractDetails(publishResult)!.taskId;

      const claimResult = await harness.exec('mteam_claim_task', {
        taskId,
        agentId: 'maker',
      }) as ToolResult<{ success?: boolean; reason?: string }>;

      expect(extractText(claimResult)).toContain('TASKTYPE_UNROUTED');
      expect(extractDetails(claimResult)?.success).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});
