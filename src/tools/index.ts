/**
 * M-Team Tools — 工具注册入口
 *
 * 每个工具独立文件，registerTools 按顺序注册所有工具。
 * 业务逻辑下沉到各自文件，index 只负责组合。
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { sanitizeTask, sanitizeTaskList } from './helpers.js';

import { register as registerPublish, } from './publish.js';
import { register as registerClaim, } from './claim.js';
import { register as registerUpdate, } from './update.js';
import { register as registerRelinquish, } from './relinquish.js';
import { register as registerReject, } from './reject.js';
import { register as registerCancel, } from './cancel.js';
import { register as registerClose, } from './close.js';
import { registerGetPending, registerGetAgentActive, registerGetTask, registerGetAllTasks } from './query.js';

// ─── re-export helpers 供子模块使用 ──────────────────────────────────────────

export { sanitizeTask, sanitizeTaskList };

// ─── registerTools ───────────────────────────────────────────────────────────

export { type MTeamPluginConfig };

export function registerTools(api: OpenClawPluginApi, config: MTeamPluginConfig): void {
  try {
    api.logger?.info('[m-team] registerTools start');

    registerPublish(api, config);
    registerClaim(api, config);
    registerUpdate(api, config);
    registerReject(api, config);
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
