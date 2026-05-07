/**
 * mteam_update_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { readStringParam } from 'openclaw/plugin-sdk/core';
import { textResult } from './shared.js';
import { updateTask } from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';
import { UpdateTaskParams } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  _config: Record<string, unknown>
): void {
  api.logger?.info('[m-team] registering mteam_update_task');
  api.registerTool({
    name: 'mteam_update_task',
    label: '更新任务',
    description: '更新任务状态或追加步骤到 context',
    parameters: UpdateTaskParams,
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const taskId = readStringParam(rawParams, 'taskId', { required: true })!;
      const agentId = rawParams.agentId as string | undefined;
      const status = rawParams.status as string | undefined;
      const contextStep = rawParams.contextStep as string | undefined;
      const contextOutput = rawParams.contextOutput as { summary?: string; files?: string[] } | undefined;
      const description = rawParams.description as string | undefined;

      if (status !== undefined && !Object.values(TaskStatus).includes(status as TaskStatus)) {
        throw new Error(`Invalid status '${status}', must be one of: ${Object.values(TaskStatus).join(', ')}`);
      }

      const contextEntry = contextStep
        ? { step: contextStep, output: contextOutput || {} }
        : null;

      const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, null, agentId ?? null);

      return textResult('任务更新成功', { task });
    },
  });
}
