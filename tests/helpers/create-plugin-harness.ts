import type {
  OpenClawPluginApi,
  PluginHookAgentEndEvent,
  PluginHookAgentContext,
  PluginHookAfterToolCallEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
  PluginHeartbeatPromptContributionEvent,
  PluginHeartbeatPromptContributionResult,
} from 'openclaw/plugin-sdk/core';
import type { SubagentRunInput } from 'openclaw/plugin-sdk';
import plugin from '../../src/index.ts';
import { setWorkspaceRoot, getTask, getTaskLogs, getAllTasks } from '../../src/pool/index.js';
import { getDb } from '../../src/pool/db.ts';
import { createTempWorkspace, type TempWorkspace } from './temp-workspace.ts';
import { createTestPluginConfig, type TestPluginConfig } from './plugin-config.ts';

export interface RegisteredTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute: (toolCallId: string, rawParams: Record<string, unknown>, toolContext?: PluginHookToolContext) => Promise<unknown>;
}

type HookMap = {
  before_tool_call: Array<(
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ) => PluginHookBeforeToolCallResult | void>;
  after_tool_call: Array<(
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext,
  ) => void | Promise<void>>;
  heartbeat_prompt_contribution: Array<(
    event: PluginHeartbeatPromptContributionEvent,
    ctx: unknown,
  ) => PluginHeartbeatPromptContributionResult | undefined>;
  agent_end: Array<(
    event: PluginHookAgentEndEvent,
    ctx: PluginHookAgentContext,
  ) => void | Promise<void>>;
};

export interface ExecOptions {
  agentId?: string;
  sessionKey?: string;
  toolContext?: PluginHookToolContext;
}

export interface PluginHarness {
  workspace: TempWorkspace;
  config: TestPluginConfig;
  api: OpenClawPluginApi & { __registeredTools: RegisteredTool[]; __hooks: HookMap; __logRecords: Array<{ level: 'info' | 'warn' | 'error'; message: string }>; __subagentRuns: SubagentRunInput[] };
  tools: RegisteredTool[];
  exec: (name: string, params?: Record<string, unknown>, options?: ExecOptions) => Promise<unknown>;
  getTool: (name: string) => RegisteredTool;
  readTask: (taskId: string) => ReturnType<typeof getTask>;
  readLogs: (taskId?: string, action?: string) => ReturnType<typeof getTaskLogs>;
  readRuntimeLogs: () => Array<{ level: 'info' | 'warn' | 'error'; message: string }>;
  readSubagentRuns: () => SubagentRunInput[];
  runHeartbeat: (agentId: string) => PluginHeartbeatPromptContributionResult | undefined;
  runAgentEnd: (event: PluginHookAgentEndEvent, ctx?: Partial<PluginHookAgentContext>) => Promise<void>;
  cleanup: () => Promise<void>;
  mutateTask: (taskId: string, mutator: (task: NonNullable<ReturnType<typeof getTask>>) => void) => void;
}

function createEmptyHooks(): HookMap {
  return {
    before_tool_call: [],
    after_tool_call: [],
    heartbeat_prompt_contribution: [],
    agent_end: [],
  };
}

function createTestApi(config: TestPluginConfig): OpenClawPluginApi & { __registeredTools: RegisteredTool[]; __hooks: HookMap } {
  const registeredTools: RegisteredTool[] = [];
  const hooks = createEmptyHooks();
  const logRecords: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
  const subagentRuns: SubagentRunInput[] = [];

  const api = {
    pluginConfig: config,
    logger: {
      info: (message: string) => { logRecords.push({ level: 'info', message }); },
      warn: (message: string) => { logRecords.push({ level: 'warn', message }); },
      error: (message: string) => { logRecords.push({ level: 'error', message }); },
    },
    registerTool(tool: RegisteredTool) {
      registeredTools.push(tool);
    },
    runtime: {
      subagent: {
        async run(input: SubagentRunInput) {
          subagentRuns.push(input);
          return { runId: 'test-run-id' };
        },
      },
      storage: {
        async get<T>(key: string): Promise<T | null> {
          if (!key.startsWith('mteam:task:')) return null;
          const taskId = key.slice('mteam:task:'.length);
          return (getTask(taskId) ?? null) as T | null;
        },
        async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
          if (prefix !== 'mteam:task:') return [];
          return getAllTasks().map(task => ({
            key: `mteam:task:${task.taskId}`,
            value: task as T,
          }));
        },
      },
    },
    on(hookName: keyof HookMap, handler: unknown) {
      const list = hooks[hookName];
      if (list) {
        list.push(handler as never);
      }
    },
    __registeredTools: registeredTools,
    __hooks: hooks,
    __logRecords: logRecords,
    __subagentRuns: subagentRuns,
  };

  return api as OpenClawPluginApi & { __registeredTools: RegisteredTool[]; __hooks: HookMap; __logRecords: Array<{ level: 'info' | 'warn' | 'error'; message: string }>; __subagentRuns: SubagentRunInput[] };
}

function buildToolContext(name: string, params: Record<string, unknown>, options: ExecOptions): PluginHookToolContext {
  if (options.toolContext) return options.toolContext;

  const agentId = options.agentId ?? (typeof params.agentId === 'string' ? params.agentId : undefined) ?? 'manager';
  const sessionKey = options.sessionKey
    ?? (typeof params.taskId === 'string' && agentId ? `agent:${agentId}:m-team:${String(params.taskId)}` : `agent:${agentId}:manual`);
  return {
    agentId,
    sessionKey,
  } as PluginHookToolContext;
}

export async function createPluginHarness(overrides: Partial<TestPluginConfig> = {}): Promise<PluginHarness> {
  const workspace = await createTempWorkspace();
  const config = createTestPluginConfig(workspace.root, overrides);
  const api = createTestApi(config);

  setWorkspaceRoot(workspace.root);
  plugin.register(api);

  const getToolByName = (name: string): RegisteredTool => {
    const tool = api.__registeredTools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  };

  return {
    workspace,
    config,
    api,
    tools: api.__registeredTools,
    exec: async (name: string, params: Record<string, unknown> = {}, options: ExecOptions = {}) => {
      const tool = getToolByName(name);
      const ctx = buildToolContext(name, params, options);

      for (const hook of api.__hooks.before_tool_call) {
        const guard = hook({ toolName: name, params } as PluginHookBeforeToolCallEvent, ctx);
        if (guard?.block) {
          return {
            content: [{ type: 'text', text: guard.blockReason ?? `${name} blocked` }],
            details: { blocked: true, reason: guard.blockReason },
          };
        }
      }

      let result: unknown;
      let error: string | undefined;
      try {
        result = await tool.execute('test-tool-call', params, ctx);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        for (const hook of api.__hooks.after_tool_call) {
          await hook({ toolName: name, params, result, error } as PluginHookAfterToolCallEvent, ctx);
        }
      }

      return result;
    },
    getTool: getToolByName,
    readTask: (taskId: string) => getTask(taskId),
    readLogs: (taskId?: string, action?: string) => getTaskLogs(taskId, action),
    readRuntimeLogs: () => api.__logRecords,
    readSubagentRuns: () => api.__subagentRuns,
    runHeartbeat: (agentId: string) => {
      let result: PluginHeartbeatPromptContributionResult | undefined;
      for (const hook of api.__hooks.heartbeat_prompt_contribution) {
        const next = hook({ agentId } as PluginHeartbeatPromptContributionEvent, {});
        if (next) result = next;
      }
      return result;
    },
    runAgentEnd: async (event, ctx = {}) => {
      const baseCtx = {
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
      } as PluginHookAgentContext;
      for (const hook of api.__hooks.agent_end) {
        await hook(event, baseCtx);
      }
    },
    cleanup: async () => {
      await workspace.cleanup();
    },
    mutateTask: (taskId, mutator) => {
      const task = getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      mutator(task);
      const db = getDb();
      db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ?, lifecycle = ? WHERE task_id = ?').run(
        task.status,
        task.completedAt,
        task.updatedAt,
        JSON.stringify(task.lifecycle),
        taskId,
      );
    },
  };
}
