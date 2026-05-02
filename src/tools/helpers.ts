/**
 * M-Team Tools — 参数读取与结果构建工具函数
 */

export interface JsonOk<T> {
  ok: true;
  data: T;
}

export interface JsonErr {
  ok: false;
  error: string;
}

export type JsonResult<T> = JsonOk<T> | JsonErr;

/** 构建工具调用结果（jsonResult 包装） */
export function jsonResult<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * 读取字符串参数
 */
export function readStr(
  rawParams: Record<string, unknown> | undefined,
  name: string,
  opts?: { required?: boolean; trim?: boolean }
): string | undefined {
  const value = rawParams?.[name];
  if (value === undefined || value === null) {
    if (opts?.required) throw new Error(`Parameter '${name}' is required`);
    return undefined;
  }
  if (typeof value !== 'string') {
    if (opts?.required) throw new Error(`Parameter '${name}' must be a string`);
    return undefined;
  }
  return opts?.trim ? value.trim() : value;
}

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
  const raw = readStr(rawParams, name, opts);
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

/**
 * 读取数字参数
 */
export function readNum(
  rawParams: Record<string, unknown> | undefined,
  name: string
): number | undefined {
  const value = rawParams?.[name];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}
