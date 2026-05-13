import type { NotificationConfig } from '../../src/notifications.js';

export interface TestPluginConfig {
  workspaceRoot: string;
  executors: string[];
  publishers: string[];
  claimRouting?: {
    taskTypeAgents?: Record<string, string[]>;
    denyUnroutedTaskTypes?: boolean;
  };
  notifications: NotificationConfig[];
  dashboardEnabled: boolean;
  dashboardPort?: number;
  agentEndJudgeAgentId?: string;
  agentEndJudgeModel?: string;
  agentEndJudgeTimeoutMs?: number;
}

export function createTestPluginConfig(workspaceRoot: string, overrides: Partial<TestPluginConfig> = {}): TestPluginConfig {
  return {
    workspaceRoot,
    executors: ['maker', 'fixer', 'scholar', 'captain'],
    publishers: ['manager'],
    notifications: [],
    dashboardEnabled: false,
    ...overrides,
  };
}
