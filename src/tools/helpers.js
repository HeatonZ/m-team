/**
 * M-Team Tools — 参数读取与结果构建工具函数
 */

import { jsonResult as _jsonResult, readStringParam, readNumberParam } from 'openclaw/plugin-sdk/core';

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
 * @param {{ required?: boolean }} [opts]
 */
export const readStr = (rawParams, name, opts) =>
  readStringParam(rawParams, name, opts);

/**
 * 读取数字参数
 * @param {object} rawParams
 * @param {string} name
 */
export const readNum = (rawParams, name) =>
  readNumberParam(rawParams, name);
