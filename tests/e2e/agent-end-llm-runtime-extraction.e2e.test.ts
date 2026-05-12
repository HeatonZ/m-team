import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { Task } from '../../src/schema/task.ts';
import type { ContextStepOutput } from '../../src/schema/task.ts';

vi.mock('openclaw/plugin-sdk/agent-runtime', () => ({
  prepareSimpleCompletionModelForAgent: vi.fn(),
  completeWithPreparedSimpleCompletionModel: vi.fn(),
  extractAssistantVisibleText: vi.fn(),
  extractAssistantText: vi.fn(),
}));

import { judgeAgentEndWithLlm } from '../../src/hooks/agentEndLlm.ts';
import * as runtime from 'openclaw/plugin-sdk/agent-runtime';

const mockPrepare = vi.mocked(runtime.prepareSimpleCompletionModelForAgent);
const mockComplete = vi.mocked(runtime.completeWithPreparedSimpleCompletionModel);
const mockExtractVisible = vi.mocked(runtime.extractAssistantVisibleText);
const mockExtractText = vi.mocked(runtime.extractAssistantText);

const sampleTask: Task = {
  taskId: 'task_test_agent_end_llm_runtime',
  taskType: 'general',
  description: '执行当前步骤',
  goal: '完成任务',
  context: [],
  priority: 'normal',
  publisher: 'manager',
  status: 'running',
  executor: 'maker',
  lastExecutor: null,
  createdAt: Date.now(),
  completedAt: null,
  updatedAt: Date.now(),
};

const sampleOutput: ContextStepOutput = {
  summary: 'ok',
  files: [],
  unresolvedIssues: [],
};

describe('agent_end llm runtime extraction boundary', () => {
  beforeEach(() => {
    mockPrepare.mockReset();
    mockComplete.mockReset();
    mockExtractVisible.mockReset();
    mockExtractText.mockReset();
    mockPrepare.mockResolvedValue({
      selection: { provider: 'openai', modelId: 'gpt-5.5', agentDir: '/tmp' },
      model: { id: 'gpt-5.5' },
      auth: { apiKey: 'test', mode: 'env' },
    });
  });

  test('parses decision from visible text when assistant text extractor is empty', async () => {
    mockComplete.mockResolvedValue({
      stopReason: 'stop',
      usage: { output: 64 },
      content: [{ type: 'text', text: '' }],
    });
    mockExtractVisible.mockReturnValue('{"decision":"next","reason":"需要下一步","nextDescription":"继续执行下一步","confidence":"high"}');
    mockExtractText.mockReturnValue('');

    const result = await judgeAgentEndWithLlm({
      cfg: {} as never,
      agentId: 'maker',
      task: sampleTask,
      transcript: 'done',
      output: sampleOutput,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe('next');
      expect(result.decision.nextDescription).toBe('继续执行下一步');
    }
  });

  test('returns explicit length-limit empty output error when model returns no text', async () => {
    mockComplete.mockResolvedValue({
      stopReason: 'length',
      usage: { output: 0 },
      content: [],
    });
    mockExtractVisible.mockReturnValue('');
    mockExtractText.mockReturnValue('');

    const result = await judgeAgentEndWithLlm({
      cfg: {} as never,
      agentId: 'maker',
      task: sampleTask,
      transcript: 'done',
      output: sampleOutput,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('LLM_DECISION_EMPTY_OUTPUT_LENGTH_LIMIT');
    }
  });

  test('maps aborted provider stop reason to timeout', async () => {
    mockComplete.mockResolvedValue({
      stopReason: 'aborted',
      errorMessage: 'Request was aborted',
      usage: { output: 0 },
      content: [],
    });
    mockExtractVisible.mockReturnValue('');
    mockExtractText.mockReturnValue('');

    const result = await judgeAgentEndWithLlm({
      cfg: {} as never,
      agentId: 'maker',
      task: sampleTask,
      transcript: 'done',
      output: sampleOutput,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('LLM_DECISION_TIMEOUT');
    }
  });
});
