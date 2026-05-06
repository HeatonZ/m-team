/**
 * M-Team Tools — 工具注册入口
 *
 * 每个工具独立文件，registerTools 按顺序注册所有工具。
 * 业务逻辑下沉到各自文件，index 只负责组合。
 *
 * 类型来源：
 *   AnyAgentTool / OpenClawPluginApi / PluginLogger → openclaw/plugin-sdk/core
 *   jsonResult / readStringParam               → openclaw/plugin-sdk/core
 *   业务逻辑（pool / notifications）            → ../pool, ../notifications
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

import { sanitizeTask, sanitizeTaskList } from './helpers.js';

import { register as registerPublish, } from './publish.js';
import { register as registerClaim, } from './claim.js';
import { register as registerUpdate, } from './update.js';
import { register as registerComplete, } from './complete.js';
import { register as registerRelay, } from './relay.js';
import { register as registerRelinquish, } from './relinquish.js';
import { register as registerCancel, } from './cancel.js';
import { register as registerClose, } from './close.js';
import { registerGetPending, registerGetAgentActive, registerGetTask, registerGetAllTasks } from './query.js';

import type { NotificationConfig } from '../notifications.js';

// ─── re-export helpers 供子模块使用 ──────────────────────────────────────────
// （shared.ts 无法 import helpers.ts，因 schema 类型依赖问题，保留在 tools 层统一导出）

export { sanitizeTask, sanitizeTaskList };

// ─── registerTools ───────────────────────────────────────────────────────────

export interface MTeamPluginConfig {
  workspaceRoot?: string;
  notifications?: NotificationConfig[];
}

export function registerTools(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  try {
    api.logger?.info('[m-team] registerTools start');

    registerPublish(api, config);
    registerClaim(api, config);
    registerUpdate(api, config);
    registerComplete(api, config);
    registerRelay(api, config);
    registerRelinquish(api, config);
    registerCancel(api, config);
    registerClose(api, config);
    registerGetPending(api);
    registerGetAgentActive(api);
    registerGetTask(api);
    registerGetAllTasks(api);

    api.logger?.info('[m-team] registerTools done');
  } catch (err) {
    api.logger?.error('[m-team] registerTools failed: ' + String(err));
  }
}
