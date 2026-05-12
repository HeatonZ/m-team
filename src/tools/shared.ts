/**
 * Shared helpers for tools.
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { PluginLogger } from 'openclaw/plugin-sdk';
import { sendNotifications } from '../notifications.js';
import type { FormattedNotification } from '../notifications.js';

export function textResult<TDetails>(text: string, details: TDetails) {
  return { content: [{ type: 'text' as const, text }], details };
}

export const failedTextResult = textResult;

export async function notifyIfNeeded(
  shouldNotify: boolean,
  getNotifications: () => FormattedNotification[],
  logger?: PluginLogger | null
): Promise<void> {
  if (!shouldNotify) return;
  try {
    await sendNotifications(getNotifications(), logger ?? undefined);
  } catch {
    logger?.warn('[m-team] notification delivery failed');
  }
}

export function readTaskId(
  rawParams: any,
  name: string,
  opts?: { required?: boolean }
): string | undefined {
  const raw = readStringParam(rawParams ?? {}, name, opts);
  if (raw === undefined) return undefined;

  if (/^\d+$/.test(raw)) {
    throw new Error(
      `taskId must use the full format task_1234567890, not a bare number like ${raw}.`
    );
  }

  if (!raw.startsWith('task_')) {
    throw new Error(
      `taskId "${raw}" is invalid. It must start with task_, for example task_1234567890.`
    );
  }

  return raw;
}
