/**
 * M-Team Tools — 参数读取与结果构建工具函数
 *
 * 这些函数是 openclaw/plugin-sdk/core 中 SDK 调用约定的内联实现，
 * 不依赖 SDK 导入，确保 CJS 格式构建兼容。
 */

// @ts-check

/** 构建工具调用结果（jsonResult 包装） */
export function jsonResult(data) {
  return { ok: true, data };
}

/**
 * 读取字符串参数
 * @param {object} rawParams
 * @param {string} name
 * @param {{ required?: boolean, trim?: boolean }} [opts]
 */
export function readStr(rawParams, name, opts) {
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
 * @param {object} rawParams
 * @param {string} name
 */
export function readNum(rawParams, name) {
  const value = rawParams?.[name];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}
