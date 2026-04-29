/**
 * Mock SDK functions — 替换 openclaw/plugin-sdk/core 中的 SDK 函数
 * 测试时通过 jest.mock 导入
 */

/**
 * @param {unknown} data
 * @returns {{ ok: true, data: unknown }}
 */
export function jsonResult(data) {
  return { ok: true, data };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} name
 * @param {{ required?: boolean, trim?: boolean }} [opts]
 * @returns {string | undefined}
 */
export function readStringParam(record, name, opts) {
  const value = record?.[name];
  if (value === undefined || value === null) {
    if (opts?.required) {
      throw new Error(`Parameter '${name}' is required`);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    if (opts?.required) {
      throw new Error(`Parameter '${name}' must be a string`);
    }
    return undefined;
  }
  return opts?.trim ? value.trim() : value;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} name
 * @returns {number | undefined}
 */
export function readNumberParam(record, name) {
  const value = record?.[name];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}
