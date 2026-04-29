/**
 * M-Team Tools — 参数读取与结果构建工具函数
 *
 * 测试策略：helpers.js 尝试从 openclaw/plugin-sdk/core 导入，
 * 失败时（测试环境无 SDK）fallback 到内联实现。
 * helpers.sdk-mock.js 的内容与 SDK API 签名完全一致。
 */

// @ts-check
let _jsonResult, _readStringParam, _readNumberParam;

try {
  // 生产环境：SDK 存在
  const sdk = await import('openclaw/plugin-sdk/core');
  _jsonResult = sdk.jsonResult;
  _readStringParam = sdk.readStringParam;
  _readNumberParam = sdk.readNumberParam;
} catch {
  // 测试环境 fallback
  _jsonResult = (data) => ({ ok: true, data });
  _readStringParam = (record, name, opts) => {
    const value = record?.[name];
    if (value === undefined || value === null) {
      if (opts?.required) throw new Error(`Parameter '${name}' is required`);
      return undefined;
    }
    if (typeof value !== 'string') {
      if (opts?.required) throw new Error(`Parameter '${name}' must be a string`);
      return undefined;
    }
    return opts?.trim ? value.trim() : value;
  };
  _readNumberParam = (record, name) => {
    const value = record?.[name];
    if (value === undefined || value === null) return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(n) ? undefined : n;
  };
}

/**
 * 构建工具调用结果（jsonResult 包装）
 * @param {unknown} data
 */
export function jsonResult(data) {
  return _jsonResult(data);
}

/**
 * 读取字符串参数
 * @param {object} rawParams
 * @param {string} name
 * @param {{ required?: boolean, trim?: boolean }} [opts]
 */
export const readStr = (rawParams, name, opts) =>
  _readStringParam(rawParams, name, opts);

/**
 * 读取数字参数
 * @param {object} rawParams
 * @param {string} name
 */
export const readNum = (rawParams, name) =>
  _readNumberParam(rawParams, name);
