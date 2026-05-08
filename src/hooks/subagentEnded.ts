/**
 * M-Team Hook — subagent_ended（统一处理）
 *
 * 目标：仅在 executor subagent 真正结束时，统一判断 complete / relay / fail。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { failTask, completeTask, relayTask } from '../pool/operations.js';
import { writeTaskLog } from '../pool/db.js';
import {
  sendNotifications,
  getNotifications,
  formatFailNotifications,
  formatRelayNotifications,
  formatTaskNotifications,
} from '../notifications.js';
import type { Task } from '../schema/task.js';

const LLM_TIMEOUT_MS = 60000;
const TERMINAL_ACTIONS = new Set(['complete', 'relay', 'fail']);

interface SubagentEndedEvent {
  targetSessionKey: string;
  targetKind: string;
  reason?: string;
  outcome: string;
  runId?: string;
  error?: string;
}

interface SubagentEndedContext {
  childSessionKey?: string;
}

function parseTaskId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  const mTeamIdx = parts.indexOf('m-team');
  if (mTeamIdx < 0 || !parts[mTeamIdx + 1]) return null;
  return parts[mTeamIdx + 1];
}

function parseAgentId(sessionKey: string): string | null {
  if (!sessionKey?.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  return parts[1] || null;
}

function readTaskFile(taskId: string, workspaceRoot: string): Task | null {
  const taskPath = path.join(workspaceRoot, 'tasks', taskId, 'task.json');
  try {
    const raw = fs.readFileSync(taskPath, 'utf8');
    return JSON.parse(raw) as Task;
  } catch {
    return null;
  }
}

function isExecutorSessionForTask(sessionKey: string | undefined, agentId: string | undefined, taskId: string): boolean {
  if (!sessionKey || !agentId) return false;
  return sessionKey === `agent:${agentId}:m-team:${taskId}`;
}

function getRelayDescription(decision: JudgeResult): string | undefined {
  if (!decision.nextDescription) return undefined;
  const next = decision.nextDescription.trim();
  const prev = (decision.previousDescription || '').trim();
  if (!next) return undefined;
  if (next === prev) return undefined;
  return next;
}

function hasTerminalLogForSession(taskId: string, sessionKey: string, workspaceRoot: string): boolean {
  const dbPath = path.join(workspaceRoot, 'queue', 'm-team.db');
  if (!fs.existsSync(dbPath)) return false;
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        `SELECT 1 FROM task_logs
         WHERE task_id = ? AND session_key = ? AND action IN ('complete','relay','fail')
         LIMIT 1`
      )
      .get(taskId, sessionKey) as { 1?: number } | undefined;
    db.close();
    return Boolean(row);
  } catch {
    return false;
  }
}

function findSessionTranscriptPath(
  sessionKey: string,
  agentId: string | undefined,
  agentDir: string | undefined,
): string | null {
  const candidates = [
    ...(agentDir ? [path.join(agentDir, '.openclaw', 'sessions')] : []),
    path.join(os.homedir(), '.openclaw', 'sessions'),
    '/tmp/openclaw/sessions',
  ];
  const names = new Set<string>([sessionKey]);
  const taskId = parseTaskId(sessionKey);
  if (taskId) names.add(taskId);
  if (agentId) names.add(`agent:${agentId}:m-team:${taskId}`);

  let newestPath: string | null = null;
  let newestMtime = -1;

  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!full.endsWith('.jsonl') && !full.endsWith('.json')) continue;
        const hit = [...names].some(name => name && full.includes(name));
        if (!hit) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = full;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return newestPath;
}

function readSessionTranscript(sessionFile: string | undefined): unknown[] {
  if (!sessionFile) return [];
  try {
    const raw = fs.readFileSync(sessionFile, 'utf8');
    const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
    const messages: unknown[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type !== 'message') continue;
        const msg = entry.message;
        if (msg) messages.push(msg);
      } catch {
        // ignore malformed line
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: unknown) => {
        const p = part as Record<string, unknown>;
        return p?.type === 'text' || p?.type === 'input_text' || p?.type === 'thinking';
      })
      .map((part: unknown) => String((part as Record<string, unknown>).text ?? (part as Record<string, unknown>).thinking ?? ''))
      .join('');
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text;
    if (typeof c.content === 'string') return c.content;
  }
  return '';
}

function formatMessages(messages: unknown[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const role = String(m.role ?? 'unknown');
    if (role === 'system') continue;
    const content = extractText(m.content);
    if (!content) continue;
    const label = role === 'user' ? 'USER' : role === 'assistant' ? 'AGENT' : `[${role}]`;
    const truncated = content.length > 4000 ? '...（前部内容截断）\n' + content.slice(-4000) : content;
    lines.push(`【${label}】${truncated}`);
  }

  return lines.join('\n\n') || '(对话记录为空)';
}

interface JudgeParams {
  runId: string;
  sessionId: string;
  sessionFile: string;
  workspaceDir: string;
}

interface JudgeResult {
  decision: 'complete' | 'relay';
  nextDescription?: string;
  contextStep: string;
  contextOutput: Record<string, unknown>;
  reason: string;
  previousDescription: string;
  descriptionChanged: boolean;
  parseStatus: 'ok' | 'llm_output_missing' | 'next_description_missing' | 'json_parse_failed' | 'timeout' | 'unknown_decision' | 'same_description_blocked';
  rawJudgeTail: string;
}

async function judgeByLlm(
  api: OpenClawPluginApi,
  task: Task,
  messages: unknown[],
  params: JudgeParams,
): Promise<JudgeResult> {
  const { goal, description, context } = task;
  const transcript = formatMessages(messages);

  const contextText = context.length > 0
    ? context.map((ctx, i) => {
        if (ctx.type === 'input') {
          return `[步骤 ${i}] 初始输入: ${JSON.stringify(ctx.data ?? {})}`;
        }
        return `[步骤 ${i}] 执行者: ${ctx.executor ?? '?'} | 步骤: ${ctx.step ?? '?'} | 输出: ${JSON.stringify(ctx.output ?? {})} | 完成时间: ${ctx.completedAt ? new Date(ctx.completedAt).toLocaleString() : '?'}`;
      }).join('\n')
    : '(无 context 历史)';

  const startMs = Date.now();
  const prompt = `你是任务完成判断专家。以下是 M-Team 任务的完整上下文：

=== 任务目标（终态标尺）===
${goal}

=== 当前步骤描述（description）===
${description || '(无描述)'}

=== Context 历史（所有已完成步骤）===
${contextText}

=== 执行者对话记录 ===
${transcript}
=== 对话记录结束 ===

请综合以上全部信息判断：

**第一步**：执行者是否完成了任务目标？
- 任务目标已达成，或 context 已包含完整执行路径 → DECISION: COMPLETE
- 任务目标未达成，还需要下一步 → DECISION: RELAY

**硬规则：如果只是 spawn 了 sub-agent、yield 等待、或还在等待其他 agent 结果，禁止 COMPLETE，必须 RELAY。**

输出格式：
DECISION: COMPLETE
REASON: <为什么判断目标已达成>
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}

或者：
DECISION: RELAY
REASON: <为什么还需要下一棒>
CONTEXT_STEP: <本次步骤描述>
CONTEXT_OUTPUT: {"summary": "<步骤总结>", "files": ["<文件路径1>", ...]}
下一步描述：<一句话描述>`.trim();

  try {
    const result = await api.runtime.agent.runEmbeddedAgent({
      sessionId: params.sessionId,
      sessionKey: void 0,
      agentId: void 0,
      messageProvider: void 0,
      messageChannel: void 0,
      sessionFile: params.sessionFile,
      workspaceDir: params.workspaceDir,
      config: api.config,
      prompt,
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      authProfileId: 'minimax:cn',
      timeoutMs: LLM_TIMEOUT_MS,
      runId: params.runId,
      trigger: 'manual',
      toolsAllow: [],
      disableTools: true,
      disableMessageTool: true,
      bootstrapContextMode: 'lightweight',
      verboseLevel: 'off',
      reasoningLevel: 'off',
      silentExpected: true,
    });

    const raw = (result.payloads ?? []).map(p => (p.text ?? '').trim()).filter(Boolean).join('\n');
    const normalized = raw.trim();
    const hasComplete = /DECISION:\s*COMPLETE/i.test(normalized);
    const hasRelay = /DECISION:\s*RELAY\b/i.test(normalized);

    let nextDescription: string | undefined;
    for (const pattern of [
      /下一步描述[：:]\s*(.+)/i,
      /NEXT[_\s]STEP[：:]\s*(.+)/i,
      /下一步[：:]\s*(.+)/i,
      /接下来[做干什么]+[：:]\s*(.+)/i,
    ]) {
      const m = normalized.match(pattern);
      if (m?.[1]?.trim()) {
        nextDescription = m[1].trim();
        break;
      }
    }

    if (hasComplete) {
      return {
        decision: 'complete',
        contextStep: extractField(normalized, 'CONTEXT_STEP') || description || '执行步骤',
        contextOutput: parseContextOutput(normalized),
        reason: extractField(normalized, 'REASON') || 'LLM 判定任务目标已达成',
        previousDescription: description || '',
        descriptionChanged: false,
        parseStatus: 'ok',
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    if (hasRelay) {
      const contextStep = extractField(normalized, 'CONTEXT_STEP') || description || '执行步骤';
      const contextOutput = parseContextOutput(normalized);
      const nextDesc = nextDescription ?? description;
      const descriptionChanged = Boolean(nextDescription && nextDescription !== description);
      const parseStatus = nextDescription ? 'ok' : 'next_description_missing';
      const reason = extractField(normalized, 'REASON') || 'LLM 判定任务目标未达成，需要下一棒继续';
      if (nextDescription && nextDescription === description) {
        return {
          decision: 'relay',
          nextDescription: undefined,
          contextStep,
          contextOutput,
          reason: 'LLM 生成的下一步描述与当前 description 完全相同，禁止原样 relay',
          previousDescription: description || '',
          descriptionChanged: false,
          parseStatus: 'same_description_blocked',
          rawJudgeTail: normalized.slice(-1000),
        };
      }
      return {
        decision: 'relay',
        nextDescription: nextDesc,
        contextStep,
        contextOutput,
        reason,
        previousDescription: description || '',
        descriptionChanged,
        parseStatus,
        rawJudgeTail: normalized.slice(-1000),
      };
    }

    return {
      decision: 'relay',
      contextStep: description || '执行步骤',
      contextOutput: {},
      nextDescription: description,
      reason: 'LLM 判决输出无法解析，兜底放回任务池',
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus: normalized ? 'unknown_decision' : 'llm_output_missing',
      rawJudgeTail: normalized.slice(-1000),
    };
  } catch (err) {
    const errorText = String(err);
    return {
      decision: 'relay',
      contextStep: description || '执行步骤',
      contextOutput: {},
      nextDescription: description,
      reason: `LLM 判断失败：${errorText.slice(0, 300)}`,
      previousDescription: description || '',
      descriptionChanged: false,
      parseStatus: /timeout|timed out/i.test(errorText) ? 'timeout' : 'unknown_decision',
      rawJudgeTail: errorText.slice(-1000),
    };
  } finally {
    const elapsedMs = Date.now() - startMs;
    console.error(`[m-team] subagent_ended judgeByLlm done taskId=${task.taskId} elapsed=${elapsedMs}ms`);
  }
}

function extractField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function parseContextOutput(raw: string): Record<string, unknown> {
  const colonIdx = raw.indexOf('CONTEXT_OUTPUT:');
  if (colonIdx === -1) return {};
  const afterLabel = raw.slice(colonIdx + 'CONTEXT_OUTPUT:'.length).trim();
  if (!afterLabel.startsWith('{')) return {};

  let depth = 0;
  let end = -1;
  for (let i = 0; i < afterLabel.length; i++) {
    const ch = afterLabel[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return {};

  try {
    return JSON.parse(afterLabel.slice(0, end)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function registerSubagentEndedHook(api: OpenClawPluginApi): void {
  (api.on as (hook: string, handler: unknown) => void)(
    'subagent_ended',
    async (eventRaw: unknown, _ctxRaw: unknown) => {
      const event = eventRaw as SubagentEndedEvent;
      const ctx = (_ctxRaw ?? {}) as SubagentEndedContext;
      const sessionKey = event.targetSessionKey ?? ctx.childSessionKey;
      const taskId = sessionKey ? parseTaskId(sessionKey) : null;
      const agentId = sessionKey ? parseAgentId(sessionKey) : null;
      if (!taskId || !sessionKey) return;
      if (event.targetKind && event.targetKind !== 'subagent') return;
      if (!isExecutorSessionForTask(sessionKey, agentId, taskId)) return;

      const pluginConfig = (api.pluginConfig ?? {}) as Record<string, unknown>;
      const workspaceRoot: string = (pluginConfig.workspaceRoot as string) ?? '/mnt/d/code/m-team';
      const task = readTaskFile(taskId, workspaceRoot);
      if (!task) {
        api.logger?.warn(`[m-team] subagent_ended: 无法读取任务 ${taskId} 的 task.json，跳过`);
        return;
      }

      if (hasTerminalLogForSession(taskId, sessionKey, workspaceRoot)) {
        console.error(`[m-team] subagent_ended skip duplicate terminal handling taskId=${taskId} sessionKey=${sessionKey}`);
        return;
      }

      console.error(
        `[m-team] subagent_ended: taskId=${taskId} agentId=${agentId ?? '?'} outcome=${event.outcome} reason=${event.reason ?? '?'} runId=${event.runId ?? '?'} error=${event.error ?? ''}`
      );

      if (event.outcome && event.outcome !== 'success') {
        const errorMsg = event.error ?? event.reason ?? event.outcome ?? 'unknown_error';
        const result = failTask(taskId, errorMsg, undefined, {
          outcome: 'error',
          error: errorMsg,
        });
        writeTaskLog({
          taskId,
          action: 'fail',
          sessionKey,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            reason: result.reason || errorMsg,
            decision: 'fail',
            parseStatus: 'ok',
            error: errorMsg,
          },
          error: errorMsg,
        });
        if (result.task) {
          sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null)
            .catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
        }
        return;
      }

      const executorAgentDir = (() => {
        const cfg = api.config as Record<string, unknown> | undefined;
        const agents = cfg?.agents as Record<string, unknown> | undefined;
        const byId = (agents?.[agentId ?? ''] as Record<string, unknown> | undefined)
          ?? ((agents?.named as Record<string, unknown> | undefined)?.[agentId ?? ''] as Record<string, unknown> | undefined);
        const raw = byId?.agentDir;
        return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
      })();

      const transcriptPath = findSessionTranscriptPath(
        sessionKey,
        agentId ?? undefined,
        executorAgentDir,
      );
      console.error(
        `[m-team][subagent_ended] transcript lookup taskId=${taskId} agentId=${agentId ?? '?'} ` +
        `agentDir=${executorAgentDir ?? '(none)'} transcriptPath=${transcriptPath ?? '(not_found)'}`
      );
      const transcriptMessages = readSessionTranscript(transcriptPath ?? undefined);
      const runId = randomUUID();
      const judgeSessionFile = path.join(os.tmpdir(), `m-team-subagent-ended-judge-${runId}.json`);

      if (transcriptMessages.length === 0) {
        const result = failTask(taskId, 'SESSION_TRANSCRIPT_EMPTY', undefined, {
          outcome: 'error',
          error: 'SESSION_TRANSCRIPT_EMPTY',
        });
        writeTaskLog({
          taskId,
          action: 'fail',
          sessionKey,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            reason: result.reason || 'SESSION_TRANSCRIPT_EMPTY',
            decision: 'fail',
            parseStatus: 'session_transcript_empty',
            transcriptPath: transcriptPath ?? null,
          },
          error: 'SESSION_TRANSCRIPT_EMPTY',
        });
        if (result.task) {
          sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null)
            .catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
        }
        return;
      }

      const decision = await judgeByLlm(api, task, transcriptMessages, {
        runId,
        sessionId: event.runId ?? runId,
        sessionFile: judgeSessionFile,
        workspaceDir: workspaceRoot,
      });

      const executorId = task.executor || 'unknown';
      if (decision.decision === 'relay') {
        if (decision.parseStatus === 'same_description_blocked') {
          const result = failTask(taskId, 'same_description_blocked', undefined, {
            outcome: 'blocked',
            error: 'same_description_blocked',
          });
          writeTaskLog({
            taskId,
            action: 'fail',
            sessionKey,
            agentId: agentId ?? undefined,
            result: {
              success: result.success,
              reason: result.reason || decision.reason,
              decision: 'relay',
              contextStep: decision.contextStep,
              contextOutput: decision.contextOutput,
              nextDescription: decision.nextDescription,
              previousDescription: decision.previousDescription,
              descriptionChanged: decision.descriptionChanged,
              parseStatus: decision.parseStatus,
              rawJudgeTail: decision.rawJudgeTail,
            },
          });
          console.error(
            `[m-team][subagent_ended] task=${taskId} decision=BLOCKED same_description -> failTask reason=${result.reason} ` +
            `prev="${(decision.previousDescription || '').slice(0, 100)}" ` +
            `next="${(decision.nextDescription || '').slice(0, 100)}" ` +
            `contextStep="${decision.contextStep.slice(0, 100)}"`
          );
          if (result.task) {
            sendNotifications(formatFailNotifications(result.task, getNotifications()), api.logger ?? null)
              .catch(err => api.logger?.error(`[m-team] fail 通知发送失败: ${String(err)}`));
          }
          return;
        }

        const relayDescription = getRelayDescription(decision);
        const result = relayTask(taskId, executorId, {
          step: decision.contextStep,
          output: decision.contextOutput,
        }, relayDescription);
        writeTaskLog({
          taskId,
          action: 'relay',
          sessionKey,
          agentId: agentId ?? undefined,
          result: {
            success: result.success,
            reason: result.reason || decision.reason,
            decision: 'relay',
            contextStep: decision.contextStep,
            contextOutput: decision.contextOutput,
            nextDescription: decision.nextDescription,
            previousDescription: decision.previousDescription,
            descriptionChanged: decision.descriptionChanged,
            parseStatus: decision.parseStatus,
            rawJudgeTail: decision.rawJudgeTail,
            transcriptPath: transcriptPath ?? null,
          },
        });
        console.error(
          `[m-team][subagent_ended] task=${taskId} decision=RELAY changed=${decision.descriptionChanged} ` +
          `parseStatus=${decision.parseStatus} previous="${(decision.previousDescription || '').slice(0, 120)}" ` +
          `next="${(decision.nextDescription || '').slice(0, 120)}" ` +
          `relaySuccess=${result.success} relayReason=${result.reason || decision.reason}`
        );
        if (result.task) {
          sendNotifications(formatRelayNotifications(result.task, getNotifications()), api.logger ?? null)
            .catch(err => api.logger?.error(`[m-team] relay 通知发送失败: ${String(err)}`));
        }
        return;
      }

      const result = completeTask(taskId, {
        step: decision.contextStep,
        output: decision.contextOutput,
      });
      writeTaskLog({
        taskId,
        action: 'complete',
        sessionKey,
        agentId: agentId ?? undefined,
        result: {
          success: result.success,
          reason: result.reason || decision.reason,
          decision: 'complete',
          contextStep: decision.contextStep,
          contextOutput: decision.contextOutput,
          previousDescription: decision.previousDescription,
          descriptionChanged: false,
          parseStatus: decision.parseStatus,
          rawJudgeTail: decision.rawJudgeTail,
          transcriptPath: transcriptPath ?? null,
        },
      });
      console.error(
        `[m-team][subagent_ended] task=${taskId} decision=COMPLETE parseStatus=${decision.parseStatus} ` +
        `contextStep="${decision.contextStep.slice(0, 120)}"`
      );
      if (result.task) {
        sendNotifications(formatTaskNotifications(result.task, getNotifications()), api.logger ?? null)
          .catch(err => api.logger?.error(`[m-team] complete 通知发送失败: ${String(err)}`));
      }
    }
  );
}
