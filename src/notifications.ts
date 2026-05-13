/**
 * M-Team notification module.
 * Handles provider config, formatting, and direct HTTP delivery.
 */

import type { Task } from './schema/task.js';

export interface NotificationConfig {
  provider: 'feishu' | 'discord';
  agents: string[];
  /** Feishu bot app_id */
  appId?: string;
  /** Feishu bot app_secret */
  appSecret?: string;
  /** Feishu target chat id (group chat_id or open_id) */
  groupId?: string;
  /** Discord target channel id */
  channelId?: string;
  /** Discord bot token */
  discordToken?: string;
}

export interface FormattedNotification {
  provider: 'feishu' | 'discord';
  chatId?: string;
  channelId?: string;
  message: string;
  appId?: string;
  appSecret?: string;
  discordToken?: string;
}

interface PluginLoggerLike {
  error(msg: string): void;
  info?(msg: string): void;
  warn?(msg: string): void;
}

export interface NotificationDeliveryTrace {
  provider: 'feishu' | 'discord';
  target: string;
  attempted: boolean;
  delivered: boolean;
  skippedReason?: string;
  error?: string;
  latencyMs?: number;
}

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 1_800;
const MAX_INLINE_TEXT_LENGTH = 280;

let _notifications: NotificationConfig[] = [];

export function setNotifications(config: NotificationConfig[]): void {
  _notifications = config ?? [];
}

export function getNotifications(): NotificationConfig[] {
  return _notifications;
}

function resolveNotificationTimeoutMs(): number {
  const envValue = Number(process.env.MTEAM_NOTIFICATION_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  return DEFAULT_NOTIFICATION_TIMEOUT_MS;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = resolveNotificationTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function clipInline(text: string | null | undefined, max = MAX_INLINE_TEXT_LENGTH): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function finalizeMessage(lines: Array<string | null | undefined>): string {
  const text = lines.filter(Boolean).join('\n').trim();
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return `${text.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

export async function sendNotifications(
  notifications: FormattedNotification[],
  logger?: PluginLoggerLike | null,
): Promise<NotificationDeliveryTrace[]> {
  if (!notifications || notifications.length === 0) return [];

  const traces: NotificationDeliveryTrace[] = [];

  for (const notif of notifications) {
    const target = notif.provider === 'feishu'
      ? notif.chatId ?? 'missing-chat-id'
      : notif.channelId ?? 'missing-channel-id';

    if (notif.provider === 'feishu') {
      if (!notif.chatId) {
        traces.push({ provider: 'feishu', target, attempted: false, delivered: false, skippedReason: 'missing-chat-id' });
        logger?.warn?.('[m-team] notification skipped provider=feishu reason=missing-chat-id');
        continue;
      }
      if (!notif.appId || !notif.appSecret) {
        traces.push({ provider: 'feishu', target, attempted: false, delivered: false, skippedReason: 'missing-credentials' });
        logger?.warn?.(`[m-team] notification skipped provider=feishu target=${notif.chatId} reason=missing-credentials`);
        continue;
      }
    } else {
      if (!notif.channelId) {
        traces.push({ provider: 'discord', target, attempted: false, delivered: false, skippedReason: 'missing-channel-id' });
        logger?.warn?.('[m-team] notification skipped provider=discord reason=missing-channel-id');
        continue;
      }
      if (!notif.discordToken) {
        traces.push({ provider: 'discord', target, attempted: false, delivered: false, skippedReason: 'missing-credentials' });
        logger?.warn?.(`[m-team] notification skipped provider=discord target=${notif.channelId} reason=missing-credentials`);
        continue;
      }
    }

    const startedAt = Date.now();
    try {
      if (notif.provider === 'feishu') {
        await sendFeishuGroupMessage(notif.chatId!, notif.message, notif.appId!, notif.appSecret!);
      } else {
        await sendDiscordDirect(notif.channelId!, notif.message, notif.discordToken!);
      }

      const latencyMs = Date.now() - startedAt;
      traces.push({ provider: notif.provider, target, attempted: true, delivered: true, latencyMs });
      logger?.info?.(`[m-team] notification delivered provider=${notif.provider} target=${target} latencyMs=${latencyMs}`);
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      traces.push({ provider: notif.provider, target, attempted: true, delivered: false, error: message, latencyMs });
      logger?.error(`[m-team] notification failed provider=${notif.provider} target=${target} latencyMs=${latencyMs} error=${message}`);
    }
  }

  const delivered = traces.filter((t) => t.delivered).length;
  const attempted = traces.filter((t) => t.attempted).length;
  const skipped = traces.length - attempted;
  logger?.info?.(`[m-team] notifications summary prepared=${notifications.length} delivered=${delivered} attempted=${attempted} skipped=${skipped}`);

  return traces;
}

// ------------------------------------------------------------
// Feishu / Discord delivery
// ------------------------------------------------------------

interface FeishuTokenCache {
  token: string;
  expireAt: number;
}

const _feishuTokenCache = new Map<string, FeishuTokenCache>();

async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = `${appId}:${appSecret}`;
  const cache = _feishuTokenCache.get(cacheKey);
  if (cache && Date.now() < cache.expireAt) return cache.token;

  const res = await fetchWithTimeout(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FEISHU_AUTH_HTTP_${res.status}: ${text}`);
  }

  const json = await res.json() as {
    code: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`FEISHU_AUTH_API_${json.code}: ${json.msg ?? 'unknown'}`);
  }

  const expireSeconds = Number(json.expire ?? 7200);
  const ttlSeconds = Math.max(60, expireSeconds - 300);
  _feishuTokenCache.set(cacheKey, {
    token: json.tenant_access_token,
    expireAt: Date.now() + ttlSeconds * 1000,
  });

  return json.tenant_access_token;
}

/**
 * Send Feishu text message to chat.
 */
export async function sendFeishuGroupMessage(
  chatId: string,
  message: string,
  appId: string,
  appSecret: string,
): Promise<void> {
  const token = await getFeishuToken(appId, appSecret);
  const body = {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: message }),
  };

  const res = await fetchWithTimeout(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FEISHU_SEND_HTTP_${res.status}: ${text}`);
  }

  const json = await res.json() as { code?: number; msg?: string };
  if (typeof json.code === 'number' && json.code !== 0) {
    throw new Error(`FEISHU_SEND_API_${json.code}: ${json.msg ?? 'unknown'}`);
  }
}

async function sendDiscordDirect(
  channelId: string,
  message: string,
  discordToken: string,
): Promise<void> {
  const res = await fetchWithTimeout(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${discordToken}`,
      },
      body: JSON.stringify({ content: message }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DISCORD_SEND_HTTP_${res.status}: ${text}`);
  }
}

// ------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------

function formatDuration(createdAt: number, endAt?: number | null): string | null {
  if (!endAt) return null;
  return `${Math.max(1, Math.round((endAt - createdAt) / 1000))}s`;
}

function buildNotification(cfg: NotificationConfig, message: string): FormattedNotification | null {
  if (cfg.provider === 'feishu') {
    return {
      provider: 'feishu',
      chatId: cfg.groupId,
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      message,
    };
  }

  return {
    provider: 'discord',
    channelId: cfg.channelId,
    discordToken: cfg.discordToken,
    message,
  };
}

function shouldNotifyAgent(cfg: NotificationConfig, ...agentIds: Array<string | null | undefined>): boolean {
  const allow = new Set(cfg.agents ?? []);
  return agentIds.some((agentId) => Boolean(agentId) && allow.has(String(agentId)));
}

function latestStep(task: Task): Task['context'][number] | null {
  return task.context.length > 0 ? task.context[task.context.length - 1] : null;
}

function latestSummary(task: Task): string | null {
  const step = latestStep(task) as { output?: { summary?: string } } | null;
  return clipInline(step?.output?.summary ?? null);
}

function latestIssue(task: Task): string | null {
  const step = latestStep(task) as { output?: { unresolvedIssues?: string[]; error?: string } } | null;
  return clipInline(step?.output?.error ?? step?.output?.unresolvedIssues?.[0] ?? null);
}

function formatBasicNotification(
  task: Task,
  notifications: NotificationConfig[],
  shouldSend: (cfg: NotificationConfig, effectiveAgent: string) => boolean,
  buildLines: (task: Task, effectiveAgent: string, duration: string | null) => string[],
): FormattedNotification[] {
  if (!notifications || notifications.length === 0) return [];

  const effectiveAgent = task.executor || task.lastExecutor || 'unknown';
  const duration = formatDuration(task.createdAt, task.completedAt ?? task.updatedAt);
  const message = finalizeMessage(buildLines(task, effectiveAgent, duration));
  if (!message) return [];

  const out: FormattedNotification[] = [];
  for (const cfg of notifications) {
    if (!shouldSend(cfg, effectiveAgent)) continue;
    const notif = buildNotification(cfg, message);
    if (notif) out.push(notif);
  }
  return out;
}

// ------------------------------------------------------------
// publish / claim / cancel
// ------------------------------------------------------------

export function formatPublishNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg) => cfg.agents.includes(task.publisher),
    (task, _agent, duration) => [
      `[PUBLISH] task=${task.taskId}`,
      `type=${task.taskType} priority=${task.priority}`,
      `publisher=${task.publisher}`,
      `goal=${clipInline(task.goal)}`,
      `step=${clipInline(task.description)}`,
      ...(duration ? [`elapsed=${duration}`] : []),
    ],
  );
}

export function formatClaimNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg) => cfg.agents.includes(task.executor ?? 'unknown'),
    (task) => [
      `[CLAIM] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `executor=${task.executor ?? 'unknown'}`,
      `step=${clipInline(task.description)}`,
    ],
  );
}

export function formatCancelNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg) => cfg.agents.includes(task.publisher),
    (task, _agent, duration) => [
      `[CANCEL] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `step=${clipInline(task.description)}`,
      ...(duration ? [`elapsed=${duration}`] : []),
    ],
  );
}

// ------------------------------------------------------------
// next / relinquish / reject
// ------------------------------------------------------------

export function formatRelinquishNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatNextOrRelinquishNotifications(task, notifications, 'relinquish');
}

export function formatNextNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatNextOrRelinquishNotifications(task, notifications, 'next');
}

function formatNextOrRelinquishNotifications(
  task: Task,
  notifications: NotificationConfig[],
  type: 'next' | 'relinquish',
): FormattedNotification[] {
  const action = type === 'next' ? 'NEXT' : 'RELINQUISH';
  return formatBasicNotification(
    task,
    notifications,
    (cfg, effectiveAgent) => shouldNotifyAgent(cfg, effectiveAgent, task.publisher),
    (task, effectiveAgent, duration) => [
      `[${action}] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `actor=${effectiveAgent}`,
      `step=${clipInline(task.description)}`,
      ...(latestSummary(task) ? [`summary=${latestSummary(task)}`] : []),
      ...(latestIssue(task) ? [`issue=${latestIssue(task)}`] : []),
      ...(duration ? [`elapsed=${duration}`] : []),
    ],
  );
}

export function formatRejectNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg, effectiveAgent) => shouldNotifyAgent(cfg, effectiveAgent, task.publisher),
    (task, effectiveAgent, duration) => [
      `[REJECT] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `executor=${effectiveAgent}`,
      `step=${clipInline(task.description)}`,
      ...(latestSummary(task) ? [`summary=${latestSummary(task)}`] : []),
      ...(latestIssue(task) ? [`issue=${latestIssue(task)}`] : []),
      ...(duration ? [`elapsed=${duration}`] : []),
    ],
  );
}

// ------------------------------------------------------------
// fail / complete / close
// ------------------------------------------------------------

export function formatFailNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  return formatBasicNotification(
    task,
    notifications,
    (cfg, effectiveAgent) => shouldNotifyAgent(cfg, effectiveAgent, task.publisher),
    (task, effectiveAgent, duration) => [
      `[FAIL] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `executor=${effectiveAgent}`,
      `step=${clipInline(task.description)}`,
      ...(latestIssue(task) ? [`reason=${latestIssue(task)}`] : []),
      ...(latestSummary(task) ? [`summary=${latestSummary(task)}`] : []),
      ...(duration ? [`elapsed=${duration}`] : []),
      'suggestion=if recoverable, publish a focused next step; otherwise补齐前置条件后重发',
    ],
  );
}

export function formatTaskNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  if (task.status !== 'completed') return [];
  return formatBasicNotification(
    task,
    notifications,
    (cfg, effectiveAgent) => shouldNotifyAgent(cfg, effectiveAgent, task.publisher),
    (task, effectiveAgent, duration) => [
      `[COMPLETE] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `executor=${effectiveAgent}`,
      `step=${clipInline(task.description)}`,
      ...(latestSummary(task) ? [`summary=${latestSummary(task)}`] : []),
      ...(duration ? [`elapsed=${duration}`] : []),
    ],
  );
}

export function formatCloseNotifications(task: Task, notifications: NotificationConfig[]): FormattedNotification[] {
  if (task.status !== 'closed') return [];
  return formatBasicNotification(
    task,
    notifications,
    (cfg) => cfg.agents.includes(task.publisher),
    (task, effectiveAgent, duration) => [
      `[CLOSE] task=${task.taskId}`,
      `type=${task.taskType}`,
      `publisher=${task.publisher}`,
      `executor=${effectiveAgent}`,
      `goal=${clipInline(task.goal)}`,
      `finalStep=${clipInline(task.description)}`,
      ...(latestSummary(task) ? [`summary=${latestSummary(task)}`] : []),
      ...(duration ? [`totalElapsed=${duration}`] : []),
    ],
  );
}

