import type { ClaimRoutingConfig } from '../config.js';
import type { Task } from '../schema/task.js';

interface ResolvedClaimRoutingConfig {
  taskTypeAgents: Map<string, Set<string>>;
  denyUnroutedTaskTypes: boolean;
}

let ROUTING_CONFIG: ResolvedClaimRoutingConfig = {
  taskTypeAgents: new Map(),
  denyUnroutedTaskTypes: false,
};

function normalizeTaskType(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toLowerCase();
}

function normalizeAgentId(raw: string | undefined | null): string {
  return String(raw ?? '').trim().toLowerCase();
}

function buildTaskTypeAgentMap(rawMap: ClaimRoutingConfig['taskTypeAgents']): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!rawMap || typeof rawMap !== 'object') return map;

  for (const [rawTaskType, rawAgents] of Object.entries(rawMap)) {
    const taskType = normalizeTaskType(rawTaskType);
    if (!taskType || !Array.isArray(rawAgents)) continue;

    const agents = new Set(
      rawAgents
        .map(item => normalizeAgentId(item))
        .filter(Boolean),
    );
    if (agents.size === 0) continue;
    map.set(taskType, agents);
  }

  return map;
}

export function setClaimRoutingConfig(config: ClaimRoutingConfig | undefined): void {
  ROUTING_CONFIG = {
    taskTypeAgents: buildTaskTypeAgentMap(config?.taskTypeAgents),
    denyUnroutedTaskTypes: Boolean(config?.denyUnroutedTaskTypes),
  };
}

function hasExplicitRoute(taskType: string): boolean {
  return ROUTING_CONFIG.taskTypeAgents.has(taskType);
}

function isAgentAllowedByRoute(taskType: string, agentId: string): boolean {
  const allowed = ROUTING_CONFIG.taskTypeAgents.get(taskType);
  if (!allowed) return true;
  return allowed.has(agentId);
}

export function canAgentClaimTask(task: Task, agentId: string): { ok: true } | { ok: false; reason: string } {
  const normalizedAgentId = normalizeAgentId(agentId);
  if (!normalizedAgentId) return { ok: false, reason: 'AGENT_ID_REQUIRED' };

  const taskType = normalizeTaskType(task.taskType) || 'general';
  const hasRoute = hasExplicitRoute(taskType);

  if (!hasRoute) {
    if (taskType === 'general') return { ok: true };
    if (ROUTING_CONFIG.denyUnroutedTaskTypes) {
      return { ok: false, reason: 'TASKTYPE_UNROUTED' };
    }
    return { ok: true };
  }

  if (!isAgentAllowedByRoute(taskType, normalizedAgentId)) {
    return { ok: false, reason: 'AGENT_TASKTYPE_ROUTE_MISMATCH' };
  }

  return { ok: true };
}

export function getClaimRoutingConfigSnapshot(): {
  taskTypeAgents: Record<string, string[]>;
  denyUnroutedTaskTypes: boolean;
} {
  const taskTypeAgents: Record<string, string[]> = {};
  for (const [taskType, agents] of ROUTING_CONFIG.taskTypeAgents.entries()) {
    taskTypeAgents[taskType] = Array.from(agents.values());
  }
  return {
    taskTypeAgents,
    denyUnroutedTaskTypes: ROUTING_CONFIG.denyUnroutedTaskTypes,
  };
}
