/**
 * M-Team Tools — 参数读取与结果构建工具函数
 *
 * jsonResult / readStringParam / readNumberParam / readStringArrayParam / ToolInputError
 * 来自 openclaw/plugin-sdk/core，与 SDK 保持一致。
 * readTaskId 是 m-team 私有格式校验。
 */

import {
  jsonResult as _jsonResult,
  readStringParam as _readStringParam,
  readNumberParam as _readNumberParam,
  readStringArrayParam as _readStringArrayParam,
} from 'openclaw/plugin-sdk/core';

// ToolInputError 在 SDK 非导出路径 'agents/tools/common'，生产代码需本地定义
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

// ─── SDK helpers（保持 SDK 原名） ─────────────────────────────────────────

export { _jsonResult as jsonResult };
export { _readStringParam as readStringParam };
export { _readNumberParam as readNumberParam };
export { _readStringArrayParam as readStringArrayParam };


// ─── m-team 兼容别名 ─────────────────────────────────────────────────────

/** readStringParam 的 m-team 别名 */
export const readStr = _readStringParam;

/** readNumberParam 的 m-team 别名 */
export const readNum = _readNumberParam;

// ─── m-team 私有格式校验 ──────────────────────────────────────────────────

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
  const raw = _readStringParam(rawParams ?? {}, name, opts);
  if (raw === undefined) return undefined;

  // 纯数字 → 无效
  if (/^\d+$/.test(raw)) {
    throw new Error(
      `taskId 不能只写纯数字，需要完整格式 task_1234567890，而非 ${raw}。` +
      `请从任务信息中复制完整的 taskId（含 task_ 前缀）。`
    );
  }

  // 必须有 task_ 前缀
  if (!raw.startsWith('task_')) {
    throw new Error(
      `taskId "${raw}" 格式无效，必须以 task_ 开头（如 task_1234567890）。` +
      `请从任务信息中复制完整的 taskId。`
    );
  }

  return raw;
}
