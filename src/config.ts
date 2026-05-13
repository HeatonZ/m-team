/**
 * 插件配置类型
 */

import type { NotificationConfig } from './notifications.js';

export interface ClaimRoutingConfig {
  taskTypeAgents?: Record<string, string[]>;
  denyUnroutedTaskTypes?: boolean;
}

export interface MTeamPluginConfig {
  workspaceRoot?: string;
  executors?: string[];
  publishers?: string[];
  claimRouting?: ClaimRoutingConfig;
  notifications?: NotificationConfig[];
  dashboardEnabled?: boolean;
  dashboardPort?: number;
  agentEndJudgeAgentId?: string;
  agentEndJudgeModel?: string;
  agentEndJudgeTimeoutMs?: number;
}
