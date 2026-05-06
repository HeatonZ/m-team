/**
 * 工具层共享工具
 *
 * - textResult / failedTextResult：SDK 标准返回格式
 * - notifyIfNeeded()：发送通知的通用 try/catch wrapper
 * - readTaskId()：taskId 格式校验
 */

import { readStringParam } from 'openclaw/plugin-sdk/core';
import type { PluginLogger } from 'openclaw/plugin-sdk';
import type { NotificationConfig } from '../notifications.js';
import { sendNotifications } from '../notifications.js';

/**
 * SDK 标准成功返回：{ content: [{type:'text', text}], details }
 * SDK 类型定义存在但运行时导出路径不在 package.json，故本地实现（行为一致）。
 */
export function textResult<TDetails>(text: string, details: TDetails) {
  return { content: [{ type: 'text' as const, text }], details };
}

/** 失败返回，与 textResult 同源同格式 */
export const failedTextResult = textResult;

/**
 * 通用通知发送（自动 catch 异常，不阻塞主流程）
 */
export async function notifyIfNeeded<T extends { task: unknown }>(
  shouldNotify: boolean,
  getNotifications: () => ReturnType<typeof import('../notifications.js').formatPublishNotifications>,
  logger: PluginLogger | null
): Promise<void> {
  if (!shouldNotify) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendNotifications(getNotifications() as any, logger);
  } catch (e) {
    logger?.warn('[m-team] 通知发送失败');
  }
}

// ─── taskId 格式校验 ─────────────────────────────────────────────────────────

/**
 * 读取 taskId 参数（带格式校验）
 * taskId 格式: task_{unix_timestamp}，必须包含前缀
 * LLM 可能截断只取数字部分，此函数显式拒绝并给出完整格式示例
 */
export function readTaskId(
  rawParams: Record<string, unknown> | undefined,
  name: string,
  opts?: { required?: boolean }
): string | undefined {
  const raw = readStringParam(rawParams ?? {}, name, opts);
  if (raw === undefined) return undefined;

  if (/^\d+$/.test(raw)) {
    throw new Error(
      `taskId 不能只写纯数字，需要完整格式 task_1234567890，而非 ${raw}。` +
      `请从任务信息中复制完整的 taskId（含 task_ 前缀）。`
    );
  }

  if (!raw.startsWith('task_')) {
    throw new Error(
      `taskId "${raw}" 格式无效，必须以 task_ 开头（如 task_1234567890）。` +
      `请从任务信息中复制完整的 taskId。`
    );
  }

  return raw;
}
