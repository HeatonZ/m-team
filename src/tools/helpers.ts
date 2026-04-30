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
