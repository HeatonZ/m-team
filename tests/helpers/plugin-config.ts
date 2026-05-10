import type { NotificationConfig } from '../../src/notifications.js';

export interface TestPluginConfig {
  workspaceRoot: string;
  executors: string[];
  publishers: string[];
  notifications: NotificationConfig[];
}

export function createTestPluginConfig(workspaceRoot: string, overrides: Partial<TestPluginConfig> = {}): TestPluginConfig {
  return {
    workspaceRoot,
    executors: ['maker', 'fixer', 'scholar', 'captain'],
    publishers: ['manager'],
    notifications: [],
    ...overrides,
  };
}
