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

interface FormattedNotification {
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

interface OpenClawApi {
  logger?: {
    error(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
  };
  config?: {
    accounts?: Array<{ type?: string; provider?: string; id?: string; accountId?: string }>;
  };
  channel?: {
    outbound?: {
      loadAdapter(opts: { channelId: string; accountId?: string }): Promise<{
        sendText(opts: { text: string }): Promise<void>;
      }>;
    };
  };
}

/**
 * 发送格式化后的通知（Feishu / Discord）
 * 不依赖 OpenClaw channel adapter，直接调 Web API
 */
export async function sendNotifications(
  notifications: FormattedNotification[],
  logger?: { error(msg: string, meta?: Record<string, unknown>): void }
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
      logger?.error(`[m-team] sendNotifications 失败: ${(err as Error).message}`, {
        provider: notif.provider,
        chatId: notif.chatId ?? notif.channelId,
        hasCredentials: !!(notif.appId && notif.appSecret) || !!notif.discordToken
      });
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
  logger?: { error(msg: string, meta?: Record<string, unknown>): void }
): Promise<string> {
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
  logger: { error: (msg: string) => void; info?: (msg: string) => void }
): Promise<void> {
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
  logger?: { error(msg: string, meta?: Record<string, unknown>): void }
): Promise<void> {
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
// 通知格式化
// ============================================================

import type { Task } from './schema/task.js';

export function formatTaskNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task || task.status !== 'completed') return [];

  // 从最后一个 context entry 取 summary（executor 填写在 contextOutput.summary）
  const lastEntry = task.context[task.context.length - 1];
  const summary = (lastEntry as { output?: { summary?: string } })?.output?.summary ?? null;

  // 耗时：completedAt - createdAt（Schema 只有这两个时间戳）
  const duration =
    task.completedAt && task.createdAt
      ? `${Math.round((task.completedAt - task.createdAt) / 1000)}秒`
      : null;

  const result: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.executor ?? 'unknown')) continue;

    if (cfg.provider === 'feishu') {
      result.push({
        provider: 'feishu',
        chatId: cfg.groupId,
        appId: cfg.appId,
        appSecret: cfg.appSecret,
        message: [
          `✅ 任务完成`,
          ``,
          `📋 ${task.description}`,
          `执行者: ${task.executor}`,
          summary ? `结果: ${summary}` : null,
          duration ? `耗时: ${duration}` : null
        ]
          .filter(Boolean)
          .join('\n')
      });
    } else if (cfg.provider === 'discord') {
      result.push({
        provider: 'discord',
        channelId: cfg.channelId,
        discordToken: cfg.discordToken,
        message: [
          `✅ **${task.description}**`,
          summary ? `_${summary}_` : null,
          `执行者: ${task.executor}${duration ? ` | 耗时: ${duration}` : ''}`
        ]
          .filter(Boolean)
          .join('\n')
      });
    }
  }

  return result;
}

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

  const lastEntry = task.context[task.context.length - 1];
  const stepLabel = type === 'relay' ? '交接' : '放弃';
  const stepEmoji = type === 'relay' ? '🔄' : '↩️';
  const lastExecutor = task.lastExecutor ?? 'unknown';

  // 取最后一步的 step 描述作为动作说明
  const stepText = (lastEntry as { type: string; step?: string })?.type === 'step'
    ? (lastEntry as { step?: string }).step ?? stepLabel
    : stepLabel;

  const duration =
    task.lastHeartbeatAt && task.createdAt
      ? `${Math.round((task.lastHeartbeatAt - task.createdAt) / 1000)}秒`
      : null;

  const result: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!cfg.agents.includes(lastExecutor)) continue;

    const lines = [
      `${stepEmoji} 任务放回池子`,
      ``,
      `📋 ${task.description}`,
      `执行者: ${lastExecutor}`,
      `动作: ${stepText}`,
      duration ? `耗时: ${duration}` : null
    ].filter(Boolean);

    const message = lines.join('\n');

    if (cfg.provider === 'feishu') {
      result.push({ provider: 'feishu', chatId: cfg.groupId, appId: cfg.appId, appSecret: cfg.appSecret, message });
    } else if (cfg.provider === 'discord') {
      result.push({ provider: 'discord', channelId: cfg.channelId, discordToken: cfg.discordToken, message });
    }
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
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const result: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.publisher)) continue;

    const lines = [
      `📋 任务已发布`,
      ``,
      `🎯 ${task.goal}`,
      `📝 ${task.description}`,
      `优先级: ${task.priority ?? 'normal'}`
    ].filter(Boolean);

    const message = lines.join('\n');

    if (cfg.provider === 'feishu') {
      result.push({ provider: 'feishu', chatId: cfg.groupId, appId: cfg.appId, appSecret: cfg.appSecret, message });
    } else if (cfg.provider === 'discord') {
      result.push({ provider: 'discord', channelId: cfg.channelId, discordToken: cfg.discordToken, message });
    }
  }

  return result;
}

export function formatClaimNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const result: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.executor ?? 'unknown')) continue;

    const lines = [
      `🏃 任务已被认领`,
      ``,
      `🎯 ${task.goal}`,
      `认领者: ${task.executor}`
    ].filter(Boolean);

    const message = lines.join('\n');

    if (cfg.provider === 'feishu') {
      result.push({ provider: 'feishu', chatId: cfg.groupId, appId: cfg.appId, appSecret: cfg.appSecret, message });
    } else if (cfg.provider === 'discord') {
      result.push({ provider: 'discord', channelId: cfg.channelId, discordToken: cfg.discordToken, message });
    }
  }

  return result;
}

export function formatCancelNotifications(
  task: Task,
  notifications: NotificationConfig[]
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  const result: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!cfg.agents.includes(task.publisher)) continue;

    const lines = [
      `🚫 任务已取消`,
      ``,
      `🎯 ${task.goal}`,
      `取消者: ${task.publisher}`
    ].filter(Boolean);

    const message = lines.join('\n');

    if (cfg.provider === 'feishu') {
      result.push({ provider: 'feishu', chatId: cfg.groupId, appId: cfg.appId, appSecret: cfg.appSecret, message });
    } else if (cfg.provider === 'discord') {
      result.push({ provider: 'discord', channelId: cfg.channelId, discordToken: cfg.discordToken, message });
    }
  }

  return result;
}
