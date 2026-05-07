/**
 * 插件级共用类型
 */

import type { NotificationConfig } from '../notifications.js';

/**
 * 插件配置 — 所有工具注册时接收的 config 对象类型
 */
export interface MTeamPluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
}
