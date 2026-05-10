/**
 * 插件配置类型
 */

import type { NotificationConfig } from './notifications.js';

export interface MTeamPluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
  dashboardEnabled?: boolean;
  dashboardPort?: number;
}
