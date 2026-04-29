/**
 * Mock openclaw/plugin-sdk/core
 * 测试环境替代品 — 提供与 SDK 相同签名的 mock 函数
 */

export function jsonResult(data) {
  return { ok: true, data };
}

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

export function readNumberParam(record, name) {
  const value = record?.[name];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export function readStringArrayParam(record, name) {
  const value = record?.[name];
  if (!Array.isArray(value)) return undefined;
  return value.filter((v) => typeof v === 'string');
}

export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}
