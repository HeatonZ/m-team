/**
 * M-Team hook: session guard.
 *
 * Guardrails:
 * - Block risky tool calls in heartbeat sessions.
 * - Block executor task sessions from forcing next/relinquish manually.
 * - Restrict publish and publisher terminal actions.
 * - Restrict publisher acceptance reads to task-scoped artifacts.
 */

import path from 'node:path';
import type {
  OpenClawPluginApi,
} from 'openclaw/plugin-sdk/core';
import type {
  OpenClawPluginToolContext,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
} from '../types/openclaw-hooks.js';
import { getTask } from '../pool/index.js';
import type { Task } from '../schema/task.js';
import { resolveAgentIdFromContext, resolvePublisherFromParamsAndContext } from '../identity.js';

interface RegisterOptions {
  publishers: string[];
  workspaceRoot?: string;
}

const DEFAULT_WORKSPACE_ROOT = '/mnt/d/code/m-team';
const PRIVATE_WORKSPACE_SEGMENT = '/.openclaw/workspace-';

function normalizePathLike(input: string): string {
  return input
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();
}

function tryToWslPath(pathLike: string): string | null {
  const normalized = normalizePathLike(pathLike);
  const match = normalized.match(/^([a-z]):\/(.*)$/);
  if (!match) return null;
  const drive = match[1];
  const rest = match[2];
  return `/mnt/${drive}/${rest}`;
}

function tryToWindowsPath(pathLike: string): string | null {
  const normalized = normalizePathLike(pathLike);
  const match = normalized.match(/^\/mnt\/([a-z])\/(.*)$/);
  if (!match) return null;
  const drive = match[1];
  const rest = match[2];
  return `${drive}:/${rest}`;
}

function buildComparableVariants(pathLike: string): Set<string> {
  const variants = new Set<string>();
  const normalized = normalizePathLike(pathLike);
  if (!normalized) return variants;
  variants.add(normalized);
  const asWsl = tryToWslPath(normalized);
  if (asWsl) variants.add(asWsl);
  const asWindows = tryToWindowsPath(normalized);
  if (asWindows) variants.add(asWindows);
  return variants;
}

function extractReadPath(params: Record<string, unknown>): string | null {
  const candidates = ['path', 'filePath', 'filepath'];
  for (const key of candidates) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function isPathWithinAllowedPrefixes(rawPath: string, prefixes: Set<string>): boolean {
  const variants = buildComparableVariants(rawPath);
  if (variants.size === 0) return false;
  for (const variant of variants) {
    for (const prefix of prefixes) {
      if (variant === prefix || variant.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

function isPrivateWorkspacePath(rawPath: string): boolean {
  const variants = buildComparableVariants(rawPath);
  for (const variant of variants) {
    if (variant.includes(PRIVATE_WORKSPACE_SEGMENT)) return true;
  }
  return false;
}

interface PublisherAcceptanceScope {
  taskId: string;
  allowedPrefixes: Set<string>;
  hasValidatedArtifactRead: boolean;
}

function addAllowedPrefix(prefixes: Set<string>, rawPrefix: string): void {
  const normalized = normalizePathLike(rawPrefix);
  if (!normalized) return;
  for (const variant of buildComparableVariants(normalized)) {
    if (!variant) continue;
    prefixes.add(variant);
    const withSlash = variant.endsWith('/') ? variant : `${variant}/`;
    prefixes.add(withSlash);
  }
}

function buildAcceptanceScope(task: Task, workspaceRoot: string): PublisherAcceptanceScope {
  const taskDir = task.acceptance?.taskDir || path.join(workspaceRoot, 'tasks', task.taskId);
  const allowedPrefixes = new Set<string>();

  addAllowedPrefix(allowedPrefixes, taskDir);

  for (const file of task.acceptance?.files ?? []) {
    const normalized = normalizePathLike(file);
    if (!normalized) continue;
    const resolved = normalized.startsWith('/') || /^[a-z]:\//.test(normalized)
      ? normalized
      : normalizePathLike(path.join(taskDir, normalized));
    addAllowedPrefix(allowedPrefixes, resolved);
  }

  if (!(task.acceptance?.files?.length)) {
    for (const entry of task.context ?? []) {
      if (entry.type !== 'step') continue;
      for (const file of entry.output?.files ?? []) {
        const normalized = normalizePathLike(file);
        if (!normalized) continue;
        const resolved = normalized.startsWith('/') || /^[a-z]:\//.test(normalized)
          ? normalized
          : normalizePathLike(path.join(taskDir, normalized));
        addAllowedPrefix(allowedPrefixes, resolved);
      }
    }
  }

  return {
    taskId: task.taskId,
    allowedPrefixes,
    hasValidatedArtifactRead: false,
  };
}

export function registerSessionGuardHook(
  api: OpenClawPluginApi,
  options: RegisterOptions,
): void {
  const publishers = new Set(options.publishers ?? []);
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const acceptanceScopeBySession = new Map<string, PublisherAcceptanceScope>();

  api.on(
    'before_tool_call',
    (
      event: PluginHookBeforeToolCallEvent,
      ctx: OpenClawPluginToolContext,
    ): PluginHookBeforeToolCallResult => {
      const { toolName, params } = event;
      const adjustedParams = params as Record<string, unknown>;
      let paramsAdjusted = false;
      const { sessionKey, agentId } = ctx;
      const resolvedAgentId = resolveAgentIdFromContext({ agentId, sessionKey });
      const isExecutorTaskSession = Boolean(
        sessionKey
        && resolvedAgentId
        && sessionKey.startsWith(`agent:${resolvedAgentId}:m-team:task_`),
      );
      const isHeartbeatSession = Boolean(sessionKey?.endsWith(':heartbeat'));
      const isPublisherHeartbeat = Boolean(
        isHeartbeatSession
        && resolvedAgentId
        && publishers.has(resolvedAgentId),
      );

      if (toolName.startsWith('mteam_')) {
        if (resolvedAgentId && typeof adjustedParams.__mteamCallerAgentId !== 'string') {
          adjustedParams.__mteamCallerAgentId = resolvedAgentId;
          paramsAdjusted = true;
        }
        if (sessionKey && typeof adjustedParams.__mteamSessionKey !== 'string') {
          adjustedParams.__mteamSessionKey = sessionKey;
          paramsAdjusted = true;
        }
      }

      if (isPublisherHeartbeat && sessionKey && toolName === 'mteam_get_task_for_publisher') {
        const inspectedTaskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (inspectedTaskId) {
          const task = getTask(inspectedTaskId);
          if (task) {
            acceptanceScopeBySession.set(sessionKey, buildAcceptanceScope(task, workspaceRoot));
          } else {
            acceptanceScopeBySession.delete(sessionKey);
          }
        }
      }

      if (
        isPublisherHeartbeat
        && sessionKey
        && (
          toolName === 'mteam_cancel_task'
          || toolName === 'mteam_relinquish_task'
        )
      ) {
        acceptanceScopeBySession.delete(sessionKey);
      }

      if (
        isHeartbeatSession
        && (
          toolName === 'mteam_complete_task'
          || toolName === 'mteam_fail_task'
          || toolName === 'mteam_next_task'
          || toolName === 'sessions_spawn'
          || toolName === 'sessions_send'
        )
      ) {
        return {
          block: true,
          blockReason: `Heartbeat session (${sessionKey}) cannot call ${toolName}. Heartbeat only handles claim/publisher acceptance.`,
        };
      }

      if (toolName === 'mteam_publish_task' && isHeartbeatSession) {
        return {
          block: true,
          blockReason: `Heartbeat session (${sessionKey}) cannot publish new tasks.`,
        };
      }

      if (isPublisherHeartbeat && toolName === 'read') {
        const readPath = extractReadPath(params);
        if (!readPath) {
          return {
            block: true,
            blockReason: `Publisher heartbeat (${sessionKey}) read requires path. Call mteam_get_task_for_publisher first and read task artifacts only.`,
          };
        }
        if (isPrivateWorkspacePath(readPath)) {
          return {
            block: true,
            blockReason: `Publisher acceptance must not read agent private workspace path (${readPath}). Use task workdir artifacts only.`,
          };
        }

        const acceptanceScope = sessionKey ? acceptanceScopeBySession.get(sessionKey) : undefined;
        if (!acceptanceScope) {
          return {
            block: true,
            blockReason: `Publisher heartbeat (${sessionKey}) must call mteam_get_task_for_publisher first, then read only that task's artifacts.`,
          };
        }

        if (!isPathWithinAllowedPrefixes(readPath, acceptanceScope.allowedPrefixes)) {
          return {
            block: true,
            blockReason: `Publisher heartbeat read blocked: ${readPath} is outside task-scoped artifacts for ${acceptanceScope.taskId}.`,
          };
        }

        acceptanceScope.hasValidatedArtifactRead = true;
      }

      if (
        isPublisherHeartbeat
        && sessionKey
        && (
          toolName === 'mteam_close_task'
          || toolName === 'mteam_reject_task'
        )
      ) {
        const acceptanceScope = acceptanceScopeBySession.get(sessionKey);
        if (!acceptanceScope) {
          return {
            block: true,
            blockReason: `Publisher heartbeat (${sessionKey}) must call mteam_get_task_for_publisher before ${toolName}.`,
          };
        }
        if (!acceptanceScope.hasValidatedArtifactRead) {
          return {
            block: true,
            blockReason: `Publisher heartbeat (${sessionKey}) must read at least one task artifact under tasks/${acceptanceScope.taskId} before ${toolName}.`,
          };
        }
      }

      if (toolName === 'mteam_relinquish_task' && isExecutorTaskSession) {
        return {
          block: true,
          blockReason: `Executor session (${sessionKey}) cannot call mteam_relinquish_task. End session and let agent_end decide.`,
        };
      }

      if (toolName === 'mteam_next_task' && isExecutorTaskSession) {
        return {
          block: true,
          blockReason: `Executor session (${sessionKey}) cannot call mteam_next_task. End session and let agent_end decide.`,
        };
      }

      if (toolName === 'mteam_publish_task' && (!resolvedAgentId || !publishers.has(resolvedAgentId))) {
        return {
          block: true,
          blockReason: `mteam_publish_task is restricted to configured publishers. agent=${resolvedAgentId ?? 'unknown'} is not allowed.`,
        };
      }

      if (
        toolName === 'mteam_close_task'
        || toolName === 'mteam_reject_task'
        || toolName === 'mteam_cancel_task'
      ) {
        const callPublisher = resolvePublisherFromParamsAndContext({
          publisher: adjustedParams.publisher as string | undefined,
          agentId: resolvedAgentId,
          sessionKey,
        });
        if (toolName === 'mteam_reject_task') {
          const reason = adjustedParams.reason;
          const description = adjustedParams.description;
          if (typeof reason !== 'string' || !reason.trim() || typeof description !== 'string' || !description.trim()) {
            return {
              block: true,
              blockReason: 'mteam_reject_task requires non-empty reason and description.',
            };
          }
        }
        if (!callPublisher) {
          return {
            block: true,
            blockReason: `${toolName} requires publisher identity. Provide publisher or use a sessionKey with agent identity.`,
          };
        }
        if (!adjustedParams.publisher) {
          adjustedParams.publisher = callPublisher;
          paramsAdjusted = true;
        }
        if (callPublisher && callPublisher !== resolvedAgentId) {
          return {
            block: true,
            blockReason: `${toolName} 无权操作: only task publisher can call this tool. publisher=${callPublisher}, agent=${resolvedAgentId ?? 'unknown'}.`,
          };
        }
      }

      return paramsAdjusted ? { params: adjustedParams } : {};
    },
  );
}
