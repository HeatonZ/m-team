/**
 * vitest global mock setup — 在所有测试之前执行
 * 拦截 openclaw 和 openclaw/plugin-sdk/core 的导入
 */
import { vi, beforeAll } from 'vitest';

// 拦截 openclaw 包
vi.mock('openclaw', () => ({}));

// 拦截 SDK core
vi.mock('openclaw/plugin-sdk/core', () => ({
  jsonResult: (data) => ({ ok: true, data }),
  readStringParam: (record, name, opts) => {
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
  },
  readNumberParam: (record, name) => {
    const value = record?.[name];
    if (value === undefined || value === null) return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(n) ? undefined : n;
  },
  readStringArrayParam: () => undefined,
  ToolInputError: class ToolInputError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ToolInputError';
    }
  },
}));
