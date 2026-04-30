/**
 * M-Team 通知配置 — 模块级单态
 * register() 时写入，tools 和 hooks 都需要访问
 */

let _notifications = [];

export function setNotifications(config) {
  _notifications = config ?? [];
}

export function getNotifications() {
  return _notifications;
}

// ============================================================
// 通知发送
// ============================================================

/**
 * 发送格式化后的通知（Feishu / Discord）
 * @param {Array} notifications - formatTaskNotifications() 格式化后的通知数组
 * @param {object} api - OpenClaw plugin api（含 channel.outbound.loadAdapter）
 */
export async function sendNotifications(notifications, api) {
  if (!notifications || notifications.length === 0) return;

  for (const notif of notifications) {
    try {
      if (notif.provider === 'feishu') {
        const accountId = await resolveFeishuAccountId(api);
        const adapter = await api.channel.outbound.loadAdapter({ channelId: notif.chatId, accountId });
        await adapter.sendText({ text: notif.message });
      } else if (notif.provider === 'discord') {
        const adapter = await api.channel.outbound.loadAdapter({ channelId: notif.channelId });
        await adapter.sendText({ text: notif.message });
      }
    } catch (err) {
      api.logger?.error(`[m-team] sendNotifications 失败: ${err.message}`, { notif });
    }
  }
}

/**
 * 从 api.config.accounts 里找到第一个 feishu 类型的 accountId
 */
async function resolveFeishuAccountId(api) {
  const accounts = api.config?.accounts ?? [];
  const feishuAccount = accounts.find(a => a.type === 'feishu' || a.provider === 'feishu');
  return feishuAccount?.id ?? feishuAccount?.accountId ?? null;
}

// ============================================================
// 通知格式化
// ============================================================

export function formatTaskNotifications(task, notifications = []) {
  if (!notifications || notifications.length === 0) return [];
  if (!task || task.status !== 'completed') return [];

  // 从最后一个 context entry 取 summary（executor 填写在 contextOutput.summary）
  const lastEntry = task.context?.[task.context.length - 1];
  const summary = lastEntry?.output?.summary ?? null;

  // 耗时：completedAt - createdAt（Schema 只有这两个时间戳）
  const duration = task.completedAt && task.createdAt
    ? `${Math.round((task.completedAt - task.createdAt) / 1000)}秒`
    : null;

  const result = [];
  for (const cfg of notifications) {
    if (!cfg.agents || !cfg.agents.includes(task.executor)) continue;

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
          duration ? `耗时: ${duration}` : null,
        ].filter(Boolean).join('\n')
      });
    } else if (cfg.provider === 'discord') {
      result.push({
        provider: 'discord',
        channelId: cfg.channelId,
        message: [
          `✅ **${task.description}**`,
          summary ? `_${summary}_` : null,
          `执行者: ${task.executor}${duration ? ` | 耗时: ${duration}` : ''}`,
        ].filter(Boolean).join('\n')
      });
    }
  }

  return result;
}

export function formatRelinquishNotifications(task, notifications = []) {
  if (!notifications || notifications.length === 0) return [];
  if (!task) return [];

  // 耗时：lastHeartbeatAt - createdAt
  const duration = task.lastHeartbeatAt && task.createdAt
    ? `${Math.round((task.lastHeartbeatAt - task.createdAt) / 1000)}秒`
    : null;

  const result = [];
  for (const cfg of notifications) {
    if (!cfg.agents || !cfg.agents.includes(task.lastExecutor)) continue;

    if (cfg.provider === 'feishu') {
      result.push({
        provider: 'feishu',
        chatId: cfg.groupId,
        message: [
          `🔄 任务放回池子`,
          ``,
          `📋 ${task.description}`,
          `执行者: ${task.lastExecutor}`,
          duration ? `耗时: ${duration}` : null,
        ].filter(Boolean).join('\n')
      });
    } else if (cfg.provider === 'discord') {
      result.push({
        provider: 'discord',
        channelId: cfg.channelId,
        message: [
          `🔄 **${task.description}**`,
          `执行者: ${task.lastExecutor}${duration ? ` | 耗时: ${duration}` : ''}`,
        ].filter(Boolean).join('\n')
      });
    }
  }

  return result;
}
