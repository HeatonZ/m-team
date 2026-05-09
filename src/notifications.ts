/**
 * M-Team 通知配置 — 模块级单态
 * register() 时写入，tools 和 hooks 都需要访问
 */

export interface NotificationConfig {
  provider: 'feishu' | 'discord';
  agents: string[];
  /** Feishu: 机器人的 app_id */
  appId?: string;
  /** Feishu: 机器人的 app_secret */
  appSecret?: string;
  /** Feishu: 接收消息的 groupId（openid 形式） */
  groupId?: string;
  /** Discord: 接收消息的 channelId */
  channelId?: string;
  /** Discord: 机器人的 bot token */
  discordToken?: string;
}

export interface FormattedNotification {
  provider: 'feishu' | 'discord';
  chatId?: string;       // Feishu groupId / open_id
  channelId?: string;    // Discord channelId
  message: string;
  // Credentials（由 formatters 从 NotificationConfig 复制过来）
  appId?: string;
  appSecret?: string;
  discordToken?: string;
}

let _notifications: NotificationConfig[] = [];

export function setNotifications(config: NotificationConfig[]): void {
  _notifications = config ?? [];
}

export function getNotifications(): NotificationConfig[] {
  return _notifications;
}

// ============================================================
// 通知发送
// ============================================================

interface PluginLoggerLike {
  error(msg: string): void;
  info?(msg: string): void;
  warn?(msg: string): void;
}

/**
 * 发送格式化后的通知（Feishu / Discord）
 * 不依赖 OpenClaw channel adapter，直接调 Web API
 */
export async function sendNotifications(
  notifications: FormattedNotification[],
  logger?: PluginLoggerLike
): Promise<void> {
  if (!notifications || notifications.length === 0) return;

  for (const notif of notifications) {
    try {
      if (notif.provider === 'feishu' && notif.chatId && notif.appId && notif.appSecret) {
        await sendFeishuGroupMessage(notif.chatId, notif.message, notif.appId, notif.appSecret, logger);
      } else if (notif.provider === 'discord' && notif.channelId && notif.discordToken) {
        await sendDiscordDirect(notif.channelId, notif.message, notif.discordToken, logger);
      }
    } catch (err) {
      logger?.error(`[m-team] sendNotifications 失败: ${(err as Error).message}`);
    }
  }
}

// ── Feishu 发送 ────────────────────────────────────────────────

interface FeishuTokenCache {
  token: string;
  expireAt: number; // ms
}

let _feishuTokenCache: FeishuTokenCache | null = null;

/**
 * 获取 Feishu tenant_access_token（带内存缓存，20分钟有效期）
 */
async function getFeishuToken(
  appId: string,
  appSecret: string,
  _logger?: { error: (msg: string) => void; info?: (msg: string) => void }
): Promise<string> {
  void _logger; // logger param reserved for future use
  // 缓存命中且未过期
  if (_feishuTokenCache && Date.now() < _feishuTokenCache.expireAt) {
    return _feishuTokenCache.token;
  }

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Feishu auth failed: ${res.status} ${text}`);
  }

  const json = await res.json() as { code: number; msg: string; tenant_access_token: string };

  if (json.code !== 0) {
    throw new Error(`Feishu auth error: ${json.code} ${json.msg}`);
  }

  // 提前 5 分钟过期，留 buffer
  _feishuTokenCache = {
    token: json.tenant_access_token,
    expireAt: Date.now() + (25 * 60 * 1000) // 缓存 25 分钟（官方 2 小时）
  };

  return json.tenant_access_token;
}

/**
 * 直接调 Feishu 消息发送 API（支持 group）
 * https://open.feishu.cn/document/server-endpoints/im-v1/message/create
 */
export async function sendFeishuGroupMessage(
  chatId: string,
  message: string,
  appId: string,
  appSecret: string,
  logger?: { error: (msg: string) => void; info?: (msg: string) => void }
): Promise<void> {
  if (!logger) return;
  const token = await getFeishuToken(appId, appSecret, logger);

  const body = {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: message })
  };

  const res = await fetch(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Feishu send failed: ${res.status} ${text}`);
  }
}

/**
 * 直接调 Discord 消息发送 API
 * https://discord.com/developers/docs/resources/channel#create-message
 */
async function sendDiscordDirect(
  channelId: string,
  message: string,
  discordToken: string,
  logger?: { error: (msg: string) => void; info?: (msg: string) => void }
): Promise<void> {
  if (!logger) return;
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${discordToken}`
      },
      body: JSON.stringify({ content: message })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord send failed: ${res.status} ${text}`);
  }
}


// ============================================================
// 通知格式化 — 共享工具
// ============================================================

import type { Task } from './schema/task.js';

/**
 * 计算耗时字符串
 */
function formatDuration(createdAt: number, endAt?: number | null): string | null {
  if (!endAt) return null;
  return `${Math.round((endAt - createdAt) / 1000)}秒`;
}

/**
 * 通用通知构建（Feishu / Discord 分流）
 */
function buildNotification(
  cfg: NotificationConfig,
  message: string
): FormattedNotification | null {
  if (cfg.provider === 'feishu') {
    return { provider: 'feishu', chatId: cfg.groupId, appId: cfg.appId, appSecret: cfg.appSecret, message };
  } else {
    return { provider: 'discord', channelId: cfg.channelId, discordToken: cfg.discordToken, message };
  }
}

/**
 * 基础通知模板：过滤 agent → 拼接消息 → 返回格式化通知
 * 用于 publish / claim / cancel / close（无特殊 status 过滤的场景）
 */
function formatBasicNotification(
  task: Task,
  notifications: NotificationConfig[],
  filterAgent: (cfg: NotificationConfig, effectiveAgent: string) => boolean,
  buildLines: (task: Task, effectiveAgent: string, duration: string | null) => string[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const effectiveAgent = task.executor || task.lastExecutor || 'unknown';
  const duration = formatDuration(task.createdAt, task.completedAt ?? task.updatedAt);
  const lines = buildLines(task, effectiveAgent, duration).filter(Boolean);
  if (lines.length === 0) return [];

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!filterAgent(cfg, effectiveAgent)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}


// ============================================================
// 通知格式化 — publish / claim / cancel
// ============================================================

export function formatPublishNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg, _agent) => cfg.agents.includes(task.publisher),
    (task) => [
      `📋 任务已发布 [${task.taskId}]`,
      ``,
      `🎯 ${task.goal}`,
      `📝 ${task.description}`,
      `优先级: ${task.priority ?? 'normal'}`
    ]
  );
}

export function formatClaimNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg, _agent) => cfg.agents.includes(task.executor ?? 'unknown'),
    (task) => [
      `🏃 任务已被认领 [${task.taskId}]`,
      ``,
      `🎯 ${task.goal}`,
      `认领者: ${task.executor}`
    ]
  );
}

export function formatCancelNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg, _agent) => cfg.agents.includes(task.publisher),
    (task) => [
      `🚫 任务已取消 [${task.taskId}]`,
      ``,
      `🎯 ${task.goal}`,
      `取消者: ${task.publisher}`
    ]
  );
}


// ============================================================
// 通知格式化 — relay / relinquish
// ============================================================

export function formatRelinquishNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  return formatRelayOrRelinquishNotifications(task, notifications, 'relinquish');
}

export function formatRelayNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  return formatRelayOrRelinquishNotifications(task, notifications, 'relay');
}

function formatRelayOrRelinquishNotifications(
  task: Task,
  notifications: NotificationConfig[],
  type: 'relay' | 'relinquish'
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const stepLabel = type === 'relay' ? '交接' : '放弃';
  const stepEmoji = type === 'relay' ? '🔄' : '↩️';
  const lastExecutor = task.lastExecutor ?? 'unknown';
  const lastEntry = task.context[task.context.length - 1];
  const stepText = (lastEntry as { type: string; step?: string })?.type === 'step'
    ? (lastEntry as { step?: string }).step ?? stepLabel
    : stepLabel;
  const duration = formatDuration(task.createdAt, task.updatedAt);

  const lines = [
    `${stepEmoji} 任务放回池子 [${task.taskId}]`,
    ``,
    `📋 ${task.description}`,
    `执行者: ${lastExecutor}`,
    `动作: ${stepText}`,
    ...(duration ? [`耗时: ${duration}`] : [])
  ].filter(Boolean);

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!cfg.agents.includes(lastExecutor)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}


// ============================================================
// 通知格式化 — reject
// ============================================================

export function formatRejectNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const lastEntry = task.context[task.context.length - 1];
  const rejectReason = (lastEntry as { step?: string })?.step ?? '';

  const lines = [
    `🔁 任务已驳回并放回池子 [${task.taskId}]`,
    ``,
    `📋 ${task.description}`,
    `执行者: ${task.executor ?? 'unknown'}`
  ].filter(Boolean);

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.executor ?? 'unknown')) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}


// ============================================================
// 通知格式化 — task（完成）/ close
// ============================================================

export function formatFailNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const lastEntry = task.context[task.context.length - 1] as
    | { step?: string; output?: { summary?: string; error?: string } }
    | undefined;
  const failureReason = lastEntry?.output?.error || lastEntry?.output?.summary || lastEntry?.step || null;
  const duration = formatDuration(task.createdAt, task.completedAt ?? task.updatedAt);
  const effectiveExecutor = task.executor || task.lastExecutor || 'unknown';

  const lines = [
    `❌ 任务失败 [${task.taskId}]`,
    ``,
    `📋 ${task.description}`,
    `执行者: ${effectiveExecutor}`,
    ...(failureReason ? [`原因: ${failureReason}`] : []),
    ...(duration ? [`耗时: ${duration}`] : []),
    `建议下一步: 如属可恢复的数据质量/约束校验问题，重新生成明确纠偏 description 后再 relay；否则补充缺失前置条件后重发任务`
  ].filter(Boolean);

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!cfg.agents.includes(effectiveExecutor)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}

export function formatTaskNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task || task.status !== 'completed') return [];

  const lastEntry = task.context[task.context.length - 1];
  const summary = (lastEntry as { output?: { summary?: string } })?.output?.summary ?? null;
  const duration = formatDuration(task.createdAt, task.completedAt);
  const effectiveExecutor = task.executor || task.lastExecutor
    || (lastEntry as { executor?: string })?.executor
    || 'unknown';

  const lines = [
    `✅ 任务完成 [${task.taskId}]`,
    ``,
    `📋 ${task.description}`,
    `执行者: ${effectiveExecutor}`,
    ...(summary ? [`结果: ${summary}`] : []),
    ...(duration ? [`耗时: ${duration}`] : [])
  ].filter(Boolean);

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!cfg.agents.includes(effectiveExecutor)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}

export function formatCloseNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task || task.status !== 'closed') return [];

  const lastEntry = task.context[task.context.length - 1];
  const summary = (lastEntry as { output?: { summary?: string } })?.output?.summary ?? null;
  const duration = formatDuration(task.createdAt, task.completedAt);

  const lines = [
    `🔒 任务已验收通过 [${task.taskId}]`,
    ``,
    `📋 ${task.description}`,
    `验收者: ${task.publisher}`,
    ...(summary ? [`结果: ${summary}`] : []),
    ...(duration ? [`总耗时: ${duration}`] : [])
  ].filter(Boolean);

  const message = lines.join('\n');
  const result: FormattedNotification[] = [];

  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.publisher)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) result.push(notif);
  }

  return result;
}
