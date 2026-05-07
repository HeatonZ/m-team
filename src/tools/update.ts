/**
 * mteam_update_task 工具定义
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult } from './shared.js';
import { updateTask } from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';
import { UpdateTaskParams } from '../types/tools.js';
import type { UpdateTaskParamsInterface } from '../types/tools.js';

export function register(
  api: OpenClawPluginApi,
  _config: MTeamPluginConfig
): void {
  api.logger?.info('[m-team] registering mteam_update_task');
  api.registerTool({
    name: 'mteam_update_task',
    label: '更新任务',
    description: '更新任务状态或追加步骤到 context',
    parameters: UpdateTaskParams,
    async execute(_toolCallId: string, rawParams: UpdateTaskParamsInterface) {
      const { taskId, agentId, status, contextStep, contextOutput, description } = rawParams;

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
