/**
 * testApi.js — 统一测试 API factory
 *
 * 职责：
 * 1. createTestPluginApi — 来自 openclaw/plugin-sdk/plugin-test-api.ts
 * 2. createMockApi — 兼容 TC 测试的 mock，包含 tool tracking
 * 3. SDK helpers — 本文件自包含实现（与 openclaw/agents/tools/common 同签名）
 *
 * 注意：不要从本文件 re-export openclaw/agents/tools/common，会触发循环 alias。
 * 生产代码请直接 import from '../../src/tools/helpers.js'。
 */

// ─── SDK helpers（自包含实现，与 openclaw/agents/tools/common 签名兼容）────────────

export function jsonResult(data) {
  return { ok: true, data };
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

// ─── createTestPluginApi（来自 openclaw/plugin-sdk/plugin-test-api.ts）────────

/**
 * @param {object} [api]
 */
export function createTestPluginApi(api = {}) {
  return {
    id: 'test-plugin',
    name: 'test-plugin',
    source: 'test',
    registrationMode: 'full',
    config: {},
    runtime: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerCliBackend() {},
    registerTextTransforms() {},
    registerService() {},
    registerGatewayDiscoveryService() {},
    registerReload() {},
    registerNodeHostCommand() {},
    registerSecurityAuditCollector() {},
    registerConfigMigration() {},
    registerMigrationProvider() {},
    registerAutoEnableProbe() {},
    registerProvider() {},
    registerSpeechProvider() {},
    registerRealtimeTranscriptionProvider() {},
    registerRealtimeVoiceProvider() {},
    registerMediaUnderstandingProvider() {},
    registerImageGenerationProvider() {},
    registerMusicGenerationProvider() {},
    registerVideoGenerationProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    registerContextEngine() {},
    registerCompactionProvider() {},
    registerAgentHarness() {},
    registerCodexAppServerExtensionFactory() {},
    registerAgentToolResultMiddleware() {},
    registerDetachedTaskRuntime() {},
    registerSessionExtension() {},
    enqueueNextTurnInjection: async (injection) => ({
      enqueued: false,
      id: '',
      sessionKey: injection.sessionKey,
    }),
    registerTrustedToolPolicy() {},
    registerToolMetadata() {},
    registerControlUiDescriptor() {},
    registerRuntimeLifecycle() {},
    registerAgentEventSubscription() {},
    setRunContext: () => false,
    getRunContext: () => undefined,
    clearRunContext() {},
    registerSessionSchedulerJob: () => undefined,
    registerMemoryCapability() {},
    registerMemoryPromptSection() {},
    registerMemoryPromptSupplement() {},
    registerMemoryCorpusSupplement() {},
    registerMemoryFlushPlan() {},
    registerMemoryRuntime() {},
    registerMemoryEmbeddingProvider() {},
    resolvePath(input) {
      return input;
    },
    on() {},
    ...api,
  };
}

// ─── createMockApi — 兼容 TC 测试的 mock ────────────────────────────────────

/**
 * Mock api 对象 — 模拟 OpenClaw 插件 api
 * tracks registered tools so we can call execute() directly in tests
 *
 * @param {object} config
 * @param {object} [config.toolOverrides]
 */
export function createMockApi(config = {}) {
  /** @type {Map<string, {name: string, execute: Function, parameters: unknown}>} */
  const tools = new Map();
  const subagentResults = new Map(); // sessionKey -> result

  const api = {
    registerTool(tool, opts = {}) {
      tools.set(tool.name, {
        name: tool.name,
        execute: tool.execute,
        parameters: tool.parameters,
        muted: opts.muted,
      });
    },

    runtime: {
      subagent: {
        run(opts) {
          const { sessionKey } = opts;
          const result = subagentResults.get(sessionKey) ?? {
            runId: `mock-run-${Date.now()}`,
            sessionKey,
          };
          return Promise.resolve(result);
        },
      },
    },

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

    // ── 以下为兼容 createTestPluginApi 的属性 ──
    id: 'test-plugin',
    name: 'test-plugin',
    source: 'test',
    registrationMode: 'full',
    config: {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  return api;
}
