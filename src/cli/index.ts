/**
 * M-Team CLI
 *
 * 用法:
 *   npx tsx src/cli/index.ts tasks create --goal "..." --description "..."
 *   npx tsx src/cli/index.ts tasks list --status pending
 *   npx tsx src/cli/index.ts tasks get <taskId>
 *   npx tsx src/cli/index.ts tasks claim <taskId> --agent-id <agentId>
 *   npx tsx src/cli/index.ts tasks complete <taskId> --step "..." [--summary "..."]
 *   npx tsx src/cli/index.ts tasks next <taskId> --agent-id <agentId> --step "..." [--description "..."]
 *   npx tsx src/cli/index.ts tasks cancel <taskId> --publisher <publisher>
 *   npx tsx src/cli/index.ts tasks close <taskId> --publisher <publisher>
 *   npx tsx src/cli/index.ts tasks relinquish <taskId> --executor-id <executorId> [--reason "..."]
 *   npx tsx src/cli/index.ts tasks update <taskId> [--status] [--step] [--description]
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
import { publishTask, claimTask, updateTask, relinquishTask, nextTask, cancelTask, completeTask, closeTask } from '../pool/index.js';
import { TaskStatus } from '../schema/task.js';

const WORKSPACE = process.env.WORKSPACE_ROOT || '/mnt/d/code/m-team';
setWorkspaceRoot(WORKSPACE);

function fatal(msg: string): never {
  console.error('[mteam] ERROR:', msg);
  process.exit(1);
}

function ok(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function parseStatus(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (!Object.values(TaskStatus).includes(s as TaskStatus)) {
    fatal(`无效状态: ${s}，可用值: ${Object.values(TaskStatus).join(', ')}`);
  }
  return s;
}

async function cmdTasks(argv: string[]) {
  const sub = argv[0];
  const args = argv.slice(1);

  switch (sub) {
    case 'create': {
      const goal = args.find(a => a === '--goal' || a === '-g') ? args[args.indexOf('--goal') + 1] ?? args[args.indexOf('-g') + 1] : undefined;
      const description = args.find(a => a === '--description' || a === '-d') ? args[args.indexOf('--description') + 1] ?? args[args.indexOf('-d') + 1] : undefined;
      const taskType = extract(args, '--task-type');
      const publisher = extract(args, '--publisher', '-p');
      const priority = extract(args, '--priority');

      if (!goal) fatal('--goal 必须提供');
      if (!description) fatal('--description 必须提供');

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
        default: fatal(`未知状态: ${status}`);
      }

      ok({ status, count: tasks.length, tasks });
      break;
    }

    case 'get': {
      const taskId = args[0];
      if (!taskId) fatal('缺少 taskId');
      const task = getTask(taskId);
      if (!task) fatal(`任务不存在: ${taskId}`);
      ok({ task });
      break;
    }

    case 'claim': {
      const taskId = args[0];
      const agentId = extract(args, '--agent-id');
      if (!taskId) fatal('缺少 taskId');
      if (!agentId) fatal('--agent-id 必须提供');

      const result = claimTask(taskId, agentId);
      if (!result.success) {
        console.error(`[mteam] claim 失败: ${result.reason}`);
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

      if (!taskId) fatal('缺少 taskId');
      if (!step) fatal('--step 必须提供');

      const contextOutput = summary || files
        ? { summary: summary ?? '', files: files ? files.split(',').map(f => f.trim()) : [] }
        : undefined;

      const result = completeTask(taskId, { step, output: contextOutput ?? {} });
      if (!result.success) {
        console.error(`[mteam] complete 失败: ${result.reason}`);
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

      if (!taskId) fatal('缺少 taskId');
      if (!agentId) fatal('--agent-id 必须提供');
      if (!step) fatal('--step 必须提供');

      const contextOutput = summary ? { summary } : undefined;
      const result = nextTask(taskId, agentId, { step, output: contextOutput ?? {} }, description);
      if (!result.success) {
        console.error(`[mteam] next 失败: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'cancel': {
      const taskId = args[0];
      const publisher = extract(args, '--publisher', '-p');
      const reason = extract(args, '--reason', '-r');

      if (!taskId) fatal('缺少 taskId');
      if (!publisher) fatal('--publisher 必须提供');

      const result = cancelTask(taskId, publisher, reason ?? undefined);
      if (!result.success) {
        console.error(`[mteam] cancel 失败: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'close': {
      const taskId = args[0];
      const publisher = extract(args, '--publisher', '-p');

      if (!taskId) fatal('缺少 taskId');
      if (!publisher) fatal('--publisher 必须提供');

      const result = closeTask(taskId, publisher);
      if (!result.success) {
        console.error(`[mteam] close 失败: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, task: result.task });
      break;
    }

    case 'relinquish': {
      const taskId = args[0];
      const executorId = extract(args, '--executor-id');
      const reason = extract(args, '--reason', '-r');

      if (!taskId) fatal('缺少 taskId');
      if (!executorId) fatal('--executor-id 必须提供');

      const result = relinquishTask(taskId, executorId, reason ?? 'cli_relinquish');
      if (!result.success) {
        console.error(`[mteam] relinquish 失败: ${result.reason}`);
        process.exit(1);
      }
      ok({ success: true, reason: result.reason, task: result.task });
      break;
    }

    case 'update': {
      const taskId = args[0];
      const status = parseStatus(extract(args, '--status', '-s'));
      const step = extract(args, '--step');
      const description = extract(args, '--description', '-d');
      const updatedAtRaw = extract(args, '--updated-at');
      const executorId = extract(args, '--executor-id');

      if (!taskId) fatal('缺少 taskId');
      if (!status && !step && !description) fatal('至少需要 --status / --step / --description 之一');

      const contextEntry = step ? { step, output: {} } : null;
      const task = updateTask(taskId, status ?? null, contextEntry, description ?? null, null, updatedAtRaw ? parseInt(updatedAtRaw, 10) : null, executorId ?? null);
      if (!task) fatal(`任务不存在: ${taskId}`);
      ok({ task });
      break;
    }

    default:
      fatal(`未知 tasks 子命令: ${sub}，可用: create, list, get, claim, complete, next, cancel, close, relinquish, update`);
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
      if (!agentId) fatal('--agent-id 必须提供');

      const activeTask = getAgentActiveTask(agentId);
      ok({ agentId, activeTask });
      break;
    }

    default:
      fatal(`未知 executors 子命令: ${sub}，可用: list, active`);
  }
}

async function cmdHeartbeat(argv: string[]) {
  const agentId = extract(argv, '--agent-id', '-a');
  if (!agentId) fatal('--agent-id 必须提供');

  const activeTask = getAgentActiveTask(agentId);
  if (!activeTask) {
    ok({ agentId, heartbeat: false, reason: 'NO_ACTIVE_TASK' });
    return;
  }

  const task = updateTask(activeTask.taskId, null, null, null, null, Date.now(), null);
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

用法:
  mteam tasks <command> [options]
  mteam executors <command> [options]
  mteam heartbeat --agent-id <agentId>

子命令:
  tasks       任务管理 (create|list|get|claim|complete|next|cancel|close|relinquish|update)
  executors   Executor 管理 (list|active)
  heartbeat   心跳保活
`);
    process.exit(0);
  }

  try {
    switch (sub) {
      case 'tasks': await cmdTasks(rest); break;
      case 'executors': await cmdExecutors(rest); break;
      case 'heartbeat': await cmdHeartbeat(rest); break;
      default:
        fatal(`未知子命令: ${sub}`);
    }
  } catch (err) {
    fatal(String(err));
  }
}

main();
