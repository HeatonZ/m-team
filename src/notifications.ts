/**
 * M-Team 通知配置 — 模块级单态
 * register() 时写入，tools 和 hooks 都需要访问
 */

export interface NotificationConfig {
  provider: 'feishu' | 'discord';
  agents: string[];
  groupId?: string;
  channelId?: string;
}

interface FormattedNotification {
  provider: 'feishu' | 'discord';
  chatId?: string;
  channelId?: string;
  message: string;
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
 */
export async function sendNotifications(
  notifications: FormattedNotification[],
  api: OpenClawApi
): Promise<void> {
  if (!notifications || notifications.length === 0) return;

  for (const notif of notifications) {
    try {
      if (notif.provider === 'feishu' && notif.chatId) {
        const accountId = await resolveFeishuAccountId(api);
        const adapter = await api.channel!.outbound!.loadAdapter({ channelId: notif.chatId, accountId: accountId ?? undefined });
        await adapter.sendText({ text: notif.message });
      } else if (notif.provider === 'discord' && notif.channelId) {
        const adapter = await api.channel!.outbound!.loadAdapter({ channelId: notif.channelId });
        await adapter.sendText({ text: notif.message });
      }
    } catch (err) {
      api.logger?.error(`[m-team] sendNotifications 失败: ${(err as Error).message}`, { notif });
    }
  }
}

/**
 * 从 api.config.accounts 里找到第一个 feishu 类型的 accountId
 */
async function resolveFeishuAccountId(api: OpenClawApi): Promise<string | null> {
  const accounts = api.config?.accounts ?? [];
  const feishuAccount = accounts.find(a => a.type === 'feishu' || a.provider === 'feishu');
  return feishuAccount?.id ?? feishuAccount?.accountId ?? null;
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
      result.push({ provider: 'feishu', chatId: cfg.groupId, message });
    } else if (cfg.provider === 'discord') {
      result.push({ provider: 'discord', channelId: cfg.channelId, message });
    }
  }

  return result;
}
