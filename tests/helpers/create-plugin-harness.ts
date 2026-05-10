import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import plugin from '../../src/index.ts';
import { setWorkspaceRoot, getTask } from '../../src/pool/index.js';
import { getDb } from '../../src/pool/db.ts';
import { createTempWorkspace, type TempWorkspace } from './temp-workspace.ts';
import { createTestPluginConfig, type TestPluginConfig } from './plugin-config.ts';

export interface RegisteredTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute: (toolCallId: string, rawParams: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginHarness {
  workspace: TempWorkspace;
  config: TestPluginConfig;
  api: OpenClawPluginApi & { __registeredTools: RegisteredTool[] };
  tools: RegisteredTool[];
  exec: (name: string, params?: Record<string, unknown>) => Promise<unknown>;
  getTool: (name: string) => RegisteredTool;
  readTask: (taskId: string) => ReturnType<typeof getTask>;
  cleanup: () => Promise<void>;
  mutateTask: (taskId: string, mutator: (task: NonNullable<ReturnType<typeof getTask>>) => void) => void;
}

function createTestApi(config: TestPluginConfig): OpenClawPluginApi & { __registeredTools: RegisteredTool[] } {
  const registeredTools: RegisteredTool[] = [];

  const api = {
    pluginConfig: config,
    logger: {
      info: (_message: string) => undefined,
      warn: (_message: string) => undefined,
      error: (_message: string) => undefined,
    },
    registerTool(tool: RegisteredTool) {
      registeredTools.push(tool);
    },
    runtime: {
      subagent: {
        async run() {
          return { runId: 'test-run-id' };
        },
      },
    },
    on: (_hookName: string, _handler: unknown) => undefined,
    __registeredTools: registeredTools,
  };

  return api as OpenClawPluginApi & { __registeredTools: RegisteredTool[] };
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
    exec: async (name: string, params: Record<string, unknown> = {}) => {
      const tool = getToolByName(name);
      return tool.execute('test-tool-call', params);
    },
    getTool: getToolByName,
    readTask: (taskId: string) => getTask(taskId),
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
