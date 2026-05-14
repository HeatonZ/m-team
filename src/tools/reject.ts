/**
 * mteam_reject_task tool definition.
 * Publisher rejects acceptance and sends task back to pending.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { MTeamPluginConfig } from '../config.js';
import { textResult, readTaskId } from './shared.js';
import { getTask, rejectTask } from '../pool/index.js';
import { formatTaskAsText } from './helpers.js';
import { formatRejectNotifications } from '../notifications.js';
import { sendNotifications } from '../notifications.js';
import { RejectTaskParams } from '../types/tools.js';
import type { RejectTaskParamsInterface } from '../types/tools.js';
import { hasDescriptionGoalDrift, hasMultiStepPattern, sanitizeSingleLine } from '../task-contract.js';
import type { Task } from '../schema/task.js';

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
  return `/mnt/${match[1]}/${match[2]}`;
}

function tryToWindowsPath(pathLike: string): string | null {
  const normalized = normalizePathLike(pathLike);
  const match = normalized.match(/^\/mnt\/([a-z])\/(.*)$/);
  if (!match) return null;
  return `${match[1]}:/${match[2]}`;
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

function includesPrivateWorkspacePath(text: string): boolean {
  const variants = buildComparableVariants(text);
  for (const variant of variants) {
    if (variant.includes(PRIVATE_WORKSPACE_SEGMENT)) return true;
  }
  return false;
}

function collectTaskArtifactFiles(task: Task): Set<string> {
  const files = new Set<string>();
  for (const entry of task.context ?? []) {
    if (entry.type !== 'step') continue;
    for (const file of entry.output?.files ?? []) {
      for (const variant of buildComparableVariants(file)) {
        files.add(variant);
      }
    }
  }
  return files;
}

function reasonHasMissingFileSignal(text: string): boolean {
  return /\b(enoent|not found|missing|does not exist)\b/i.test(text);
}

function extractPathCandidates(text: string): string[] {
  if (!text) return [];
  const candidates = new Set<string>();
  const patterns = [
    /(?:\/mnt\/[a-z]\/[^\s'"`]+|\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+)/ig,
    /(?:[a-z]:\\[^\s'"`]+|[a-z]:\/[^\s'"`]+)/ig,
  ];
  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];
    for (const raw of matches) {
      const cleaned = raw.replace(/[.,;:!?]+$/g, '');
      if (cleaned) candidates.add(cleaned);
    }
  }
  return [...candidates];
}

function hasEvidenceConflict(task: Task, reasonText: string, descriptionText: string): boolean {
  const merged = `${reasonText}\n${descriptionText}`;
  if (!reasonHasMissingFileSignal(merged)) return false;

  const candidates = extractPathCandidates(merged);
  const artifactFiles = collectTaskArtifactFiles(task);
  if (artifactFiles.size === 0) return false;

  if (candidates.length === 0) return false;
  for (const candidate of candidates) {
    const variants = buildComparableVariants(candidate);
    for (const variant of variants) {
      if (artifactFiles.has(variant)) {
        return true;
      }
    }
  }

  return false;
}

export function register(
  api: OpenClawPluginApi,
  config: MTeamPluginConfig,
): void {
  api.logger?.info('[m-team] registering mteam_reject_task');
  api.registerTool({
    name: 'mteam_reject_task',
    label: 'Reject task',
    description: 'Publisher rejects a completed task and sets the next step',
    parameters: RejectTaskParams,
    async execute(_toolCallId: string, rawParams: RejectTaskParamsInterface) {
      const taskId = readTaskId(rawParams, 'taskId', { required: true })!;
      const { reason, description, publisher } = rawParams;
      if (!publisher) {
        throw new Error('mteam_reject_task missing publisher');
      }
      const task = getTask(taskId);
      if (!task) {
        return textResult('reject failed: TASK_NOT_FOUND', { success: false, reason: 'TASK_NOT_FOUND' });
      }

      const nextDescription = sanitizeSingleLine(description);
      if (!nextDescription) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_REQUIRED: description is required.');
      }
      if (hasMultiStepPattern(nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_MULTI_STEP: description must be one current baton.');
      }
      if (hasDescriptionGoalDrift(nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_DESCRIPTION_GOAL_DRIFT: description must be current-step work only.');
      }
      if (includesPrivateWorkspacePath(reason) || includesPrivateWorkspacePath(nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_REASON_INVALID_PATH_SCOPE: reason/description must not reference private workspace-* paths.');
      }
      if (hasEvidenceConflict(task, reason, nextDescription)) {
        throw new Error('mteam_reject_task invalid input:\n- REJECT_REASON_EVIDENCE_CONFLICT: reason claims missing artifact but task context already contains that artifact evidence.');
      }

      const result = rejectTask(taskId, publisher, reason, nextDescription);
      if (!result.success) {
        return textResult(`reject failed: ${result.reason}`, { success: false, reason: result.reason });
      }
      const updatedTask = result.task;

      if (config.notifications?.length && updatedTask) {
        try {
          const notifications = formatRejectNotifications(updatedTask, config.notifications);
          await sendNotifications(notifications, api.logger ?? null);
        } catch {
          api.logger?.warn('[m-team] reject notifications failed');
        }
      }

      return textResult(`任务已驳回\n${updatedTask ? formatTaskAsText(updatedTask, { includeGoal: true }) : `Task ${taskId}`}`, { task: updatedTask });
    },
  });
}
