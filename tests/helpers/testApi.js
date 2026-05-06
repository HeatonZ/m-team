/**
 * testApi.js — 统一测试 API factory
 *
 * 职责：
 * 1. createTestPluginApi — 来自 openclaw/plugin-sdk/plugin-test-api（官方 SDK）
 * 2. createMockApi — 测试扩展层：追踪 registered tools，支持 getTool().execute()
 * 3. SDK helpers — 本文件自包含实现（与 openclaw/agents/tools/common 签名兼容）
 *    供 src/tools/helpers.ts 使用（通过 vitest alias 指向本文件）
 * 4. callTool / extract — 测试框架工具
 *
 * 注意：
 * - helpers（jsonResult/readStringParam 等）用本地 mock，与 SDK 签名兼容，
 *   因为 vitest.config.js 将 openclaw/plugin-sdk/core 和 openclaw/agents/tools/common
 *   alias 到本文件。
 * - 生产代码（src/tools/）通过 openclaw/plugin-sdk/core 拿真正的 SDK helpers。
 */

import { createTestPluginApi } from 'openclaw/plugin-sdk/plugin-test-api';

// ─── SDK helpers 自包含实现 ──────────────────────────────────────────────────
// 与 openclaw/agents/tools/common 签名兼容，供 helpers.ts 使用

/**
 * m-team 格式的结果包装器（与 SDK jsonResult 兼容）
 * 返回 { ok: true, data: {...} }，extract() 统一处理
 */
export function jsonResult(data) {
  return { ok: true, data };
}

/**
 * 成功文本结果（与 SDK textResult 兼容）
 * 格式: { ok: true, data: { text, ...details } }
 */
export function textResult(text, details = {}) {
  return { ok: true, data: { text, ...details } };
}

/**
 * 失败文本结果（与 SDK failedTextResult 兼容）
 * 格式: { ok: false, error: string, data: { status: "failed", ...details } }
 */
export function failedTextResult(message, details = {}) {
  return { ok: false, error: message, data: { status: 'failed', ...details } };
}

export function readStringParam(record, name, opts) {
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

// ─── createTestPluginApi（官方 SDK）──────────────────────────────────────────

export { createTestPluginApi };

// ─── createMockApi — 测试扩展层 ──────────────────────────────────────────────

/**
 * 基于官方 createTestPluginApi 的测试用 API。
 * 叠加 tool tracking：拦截 registerTool() 调用，存储到内部 Map，
 * 支持 getTool(name).execute() 直接调用。
 *
 * @param {object} config
 * @param {object[]} [config.notifications]
 */
export function createMockApi(config = {}) {
  const tools = new Map();
  const subagentResults = new Map(); // sessionKey -> result

  // 用官方 SDK 创建基础 API
  const base = createTestPluginApi({
    pluginConfig: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  // 拦截 registerTool，追踪所有注册的 tool
  const originalRegisterTool = base.registerTool.bind(base);
  base.registerTool = (tool, opts = {}) => {
    if (Array.isArray(tool)) {
      // ChannelAgentToolFactory 或 tool 数组，暂不支持
      return originalRegisterTool(tool, opts);
    }
    tools.set(tool.name, {
      name: tool.name,
      execute: typeof tool.execute === 'function' ? tool.execute.bind(tool) : undefined,
      parameters: tool.parameters,
      muted: opts?.muted,
    });
    originalRegisterTool(tool, opts);
  };

  const api = Object.assign(base, {
    notifications: config.notifications ?? [],

    __setSubagentResult(sessionKey, result) {
      subagentResults.set(sessionKey, result);
    },

    /** 根据 name 获取已注册的 tool */
    getTool(name) {
      return tools.get(name);
    },

    /** 获取所有已注册的 tool names */
    getToolNames() {
      return [...tools.keys()];
    },
  });

  // runtime.subagent.run mock
  if (!api.runtime) api.runtime = {};
  if (!api.runtime.subagent) api.runtime.subagent = {};
  api.runtime.subagent.run = (opts) => {
    const { sessionKey } = opts;
    const result = subagentResults.get(sessionKey) ?? {
      runId: `mock-run-${Date.now()}`,
      sessionKey,
    };
    return Promise.resolve(result);
  };

  return api;
}

// ─── callTool — 执行已注册的 tool ───────────────────────────────────────────

/**
 * 在 api 上按 name 查找 tool 并执行。
 * @param {ReturnType<typeof createMockApi>} api
 * @param {string} toolName
 * @param {object} params
 */
export async function callTool(api, toolName, params) {
  const tool = api.getTool(toolName);
  if (!tool) throw new Error(`[testApi] Tool not found: ${toolName}`);
  if (tool.muted) return undefined;
  const raw = await tool.execute('mock-call-id', params);
  return raw;
}

// ─── extract — 从 tool 返回值提取业务数据 ───────────────────────────────────

/**
 * 统一 extract：
 * m-team mock 格式: { ok: true, data: {...} }
 * SDK jsonResult 格式: { content: [{ type: 'text', text: '...' }] }
 */
export function extract(result) {
  // m-team mock 格式（src/tools/helpers.ts 返回的格式）
  if (result && result.ok === true) return result.data;
  // failedTextResult 格式：{ ok: false, error: string, data: {...} }
  if (result && result.ok === false && result.data) return result.data;
  // SDK content 格式
  if (result && Array.isArray(result.content)) {
    const text =
      result.content.find?.((c) => c.type === 'text') ?? result.content[0];
    if (text?.text) {
      try {
        return JSON.parse(text.text);
      } catch {}
    }
    return result.content;
  }
  return result;
}
