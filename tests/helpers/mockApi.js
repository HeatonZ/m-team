/**
 * Mock api 对象 — 模拟 OpenClaw 插件 api
 * tracks registered tools so we can call execute() directly in tests
 */

export function createMockApi(config = {}) {
  /** @type {Map<string, {name: string, execute: Function, parameters: unknown}>} */
  const tools = new Map();

  const subagentResults = new Map(); // sessionKey -> result

  const api = {
    /**
     * @param {object} tool
     * @param {{ muted?: boolean }} [opts]
     */
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
        /**
         * @param {{ sessionKey: string, message: string }} opts
         */
        run(opts) {
          const { sessionKey } = opts;
          // 返回预设结果，或默认
          const result = subagentResults.get(sessionKey) ?? {
            runId: `mock-run-${Date.now()}`,
            sessionKey,
          };
          return Promise.resolve(result);
        },
      },
    },

    notifications: config.notifications ?? [],

    /**
     * 预设 subagent.run 的返回结果
     * @param {string} sessionKey
     * @param {object} result
     */
    __setSubagentResult(sessionKey, result) {
      subagentResults.set(sessionKey, result);
    },

    /**
     * 根据 name 获取已注册的 tool
     * @param {string} name
     */
    getTool(name) {
      return tools.get(name);
    },

    /**
     * 获取所有已注册的 tool names
     */
    getToolNames() {
      return [...tools.keys()];
    },
  };

  return api;
}
