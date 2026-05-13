/**
 * M-Team CLI
 *
 * Usage:
 *   npx tsx src/cli/index.ts tasks create --goal "..." --description "..."
 *   npx tsx src/cli/index.ts tasks list --status pending
 *   npx tsx src/cli/index.ts tasks get <taskId>
 *   npx tsx src/cli/index.ts tasks claim <taskId> --agent-id <agentId>
 *   npx tsx src/cli/index.ts tasks complete <taskId> --step "..." [--summary "..."] [--files "a,b"]
 *   npx tsx src/cli/index.ts tasks next <taskId> --agent-id <agentId> --step "..." [--summary "..."] [--description "..."]
 *   npx tsx src/cli/index.ts tasks cancel <taskId> --publisher <publisher> [--reason "..."]
 *   npx tsx src/cli/index.ts tasks close <taskId> --publisher <publisher>
 *   npx tsx src/cli/index.ts tasks relinquish <taskId> --executor-id <executorId> [--reason "..."]
 *   npx tsx src/cli/index.ts tasks touch <taskId> [--executor-id <executorId>]
 *   npx tsx src/cli/index.ts executors list
 *   npx tsx src/cli/index.ts executors active --agent-id <agentId>
 *   npx tsx src/cli/index.ts heartbeat --agent-id <agentId>
 */

import {
  setWorkspaceRoot,
  getAllTasks,
  getPendingTasks,
  getRunningTasks,
  getCompletedTasks,
  getFailedTasks,
  getCancelledTasks,
  getClosedTasks,
  getTask,
  getAgentActiveTask,
} from '../pool/index.js';
import {
  publishTask,
  claimTask,
  updateTask,
  relinquishTask,
  nextTask,
  cancelTask,
  completeTask,
  closeTask,
} from '../pool/index.js';
import { TaskStatus, VALID_TASK_TYPES, type TaskType } from '../schema/task.js';

const WORKSPACE = process.env.WORKSPACE_ROOT || '/mnt/d/code/m-team';
setWorkspaceRoot(WORKSPACE);

function fatal(msg: string): never {
  console.error('[mteam] ERROR:', msg);
  process.exit(1);
}

function ok(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function parseTaskType(value: string | undefined): TaskType | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!VALID_TASK_TYPES.includes(normalized as TaskType)) {
    fatal(`invalid taskType: ${value}; allowed: ${VALID_TASK_TYPES.join(', ')}`);
  }
  return normalized as TaskType;
}

async function cmdTasks(argv: string[]) {
  const sub = argv[0];
  const args = argv.slice(1);

  switch (sub) {
    case 'create': {
      const goal = extract(args, '--goal', '-g');
      const description = extract(args, '--description', '-d');
      const taskType = extract(args, '--task-type');
      const publisher = extract(args, '--publisher', '-p');
      const priority = extract(args, '--priority');

      if (!goal) fatal('--goal is required');
      if (!description) fatal('--description is required');

      const taskId = publishTask({
        taskType: taskType ?? undefined,
        description,
        goal,
        publisher: publisher ?? 'cli',
        priority: priority ?? undefined,
      });

      ok({ taskId });
      break;
    }

    case 'list': {
      const status = extract(args, '--status', '-s') ?? 'pending';
      let tasks;

      switch (status) {
        case 'pending': tasks = getPendingTasks(); break;
        case 'running': tasks = getRunningTasks(); break;
        case 'completed': tasks = getCompletedTasks(); break;
        case 'failed': tasks = getFailedTasks(); break;
        case 'cancelled': tasks = getCancelledTasks(); break;
        case 'closed': tasks = getClosedTasks(); break;
        case 'all': tasks = getAllTasks(); break;
        default: fatal(`unknown status: ${status}`);
      }

      ok({ status, count: tasks.length, tasks });
      break;
    }

    case 'get': {
      const taskId = args[0];
      if (!taskId) fatal('taskId is required');
      const task = getTask(taskId);
      if (!task) fatal(`task not found: ${taskId}`);
      ok({ task });
      break;
    }

    case 'claim': {
      const taskId = args[0];
      const agentId = extract(args, '--agent-id');
      if (!taskId) fatal('taskId is required');
      if (!agentId) fatal('--agent-id is required');

      const result = claimTask(taskId, agentId);
      if (!result.success) {
        console.error(`[mteam] claim failed: ${result.reason}`);
        process.exit(1);
      }
      ok(result);
      break;
    }

    case 'complete': {
      const taskId = args[0];
      const step = extract(args, '--step', '-s');
      const summary = extract(args, '--summary');
      const files = extract(args, '--files');

      if (!taskId) fatal('taskId is required');
      if (!step) fatal('--step is required');

      const contextOutput = summary || files
        ? {
          ...(summary ? { summary } : {}),
          ...(files ? { files: files.split(',').map((f) => f.trim()).filter(Boolean) } : {}),
        }
        : undefined;

      const result = completeTask(taskId, { step, output: contextOutput ?? {} });
      if (!result.success) {
        console.error(`[mteam] complete failed: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'next': {
      const taskId = args[0];
      const agentId = extract(args, '--agent-id');
      const step = extract(args, '--step', '-s');
      const summary = extract(args, '--summary');
      const description = extract(args, '--description', '-d');
      const nextTaskType = parseTaskType(extract(args, '--next-task-type'));

      if (!taskId) fatal('taskId is required');
      if (!agentId) fatal('--agent-id is required');
      if (!step) fatal('--step is required');

      const contextOutput = summary ? { summary } : undefined;
      const result = nextTask(taskId, agentId, { step, output: contextOutput ?? {} }, description, nextTaskType);
      if (!result.success) {
        console.error(`[mteam] next failed: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'cancel': {
      const taskId = args[0];
      const publisher = extract(args, '--publisher', '-p');
      const reason = extract(args, '--reason', '-r');

      if (!taskId) fatal('taskId is required');
      if (!publisher) fatal('--publisher is required');

      const result = cancelTask(taskId, publisher, reason ?? undefined);
      if (!result.success) {
        console.error(`[mteam] cancel failed: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'close': {
      const taskId = args[0];
      const publisher = extract(args, '--publisher', '-p');

      if (!taskId) fatal('taskId is required');
      if (!publisher) fatal('--publisher is required');

      const result = closeTask(taskId, publisher);
      if (!result.success) {
        console.error(`[mteam] close failed: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'relinquish': {
      const taskId = args[0];
      const executorId = extract(args, '--executor-id');
      const reason = extract(args, '--reason', '-r');

      if (!taskId) fatal('taskId is required');
      if (!executorId) fatal('--executor-id is required');

      const result = relinquishTask(taskId, executorId, reason ?? 'cli_relinquish');
      if (!result.success) {
        console.error(`[mteam] relinquish failed: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, reason: result.reason, task: result.task });
      break;
    }

    case 'touch': {
      const taskId = args[0];
      const executorId = extract(args, '--executor-id') ?? null;

      if (!taskId) fatal('taskId is required');

      const task = updateTask(taskId, null, null, null, Date.now(), executorId);
      if (!task) fatal(`task not found: ${taskId}`);
      ok({ success: true, taskId, updatedAt: task.updatedAt });
      break;
    }

    default:
      fatal(`unknown tasks command: ${sub}; available: create, list, get, claim, complete, next, cancel, close, relinquish, touch`);
  }
}

async function cmdExecutors(argv: string[]) {
  const sub = argv[0];
  const args = argv.slice(1);

  switch (sub) {
    case 'list': {
      const allTasks = getAllTasks();
      const executorMap = new Map<string, { running: number; completed: number; failed: number }>();

      for (const task of allTasks) {
        if (task.executor) {
          const e = executorMap.get(task.executor) ?? { running: 0, completed: 0, failed: 0 };
          if (task.status === TaskStatus.RUNNING) e.running++;
          else if (task.status === TaskStatus.COMPLETED) e.completed++;
          else if (task.status === TaskStatus.FAILED) e.failed++;
          executorMap.set(task.executor, e);
        }
      }

      const executors = Array.from(executorMap.entries()).map(([id, stats]) => ({
        executorId: id,
        ...stats,
      }));

      ok({ count: executors.length, executors });
      break;
    }

    case 'active': {
      const agentId = extract(args, '--agent-id');
      if (!agentId) fatal('--agent-id is required');

      const activeTask = getAgentActiveTask(agentId);
      ok({ agentId, activeTask });
      break;
    }

    default:
      fatal(`unknown executors command: ${sub}; available: list, active`);
  }
}

async function cmdHeartbeat(argv: string[]) {
  const agentId = extract(argv, '--agent-id', '-a');
  if (!agentId) fatal('--agent-id is required');

  const activeTask = getAgentActiveTask(agentId);
  if (!activeTask) {
    ok({ agentId, heartbeat: false, reason: 'NO_ACTIVE_TASK' });
    return;
  }

  const task = updateTask(activeTask.taskId, null, null, null, Date.now(), null);
  ok({ agentId, heartbeat: true, taskId: activeTask.taskId, updatedAt: task?.updatedAt });
}

function extract(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
  }
  return undefined;
}

async function main() {
  const sub = process.argv[2];
  const rest = process.argv.slice(3);

  if (!sub) {
    console.log(`M-Team CLI

Usage:
  mteam tasks <command> [options]
  mteam executors <command> [options]
  mteam heartbeat --agent-id <agentId>

Subcommands:
  tasks       create|list|get|claim|complete|next|cancel|close|relinquish|touch
  executors   list|active
  heartbeat   refresh active-task heartbeat
`);
    process.exit(0);
  }

  try {
    switch (sub) {
      case 'tasks': await cmdTasks(rest); break;
      case 'executors': await cmdExecutors(rest); break;
      case 'heartbeat': await cmdHeartbeat(rest); break;
      default:
        fatal(`unknown command: ${sub}`);
    }
  } catch (err) {
    fatal(String(err));
  }
}

main();
