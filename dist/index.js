// src/index.js
import fs3 from "node:fs";
import path3 from "node:path";
import { definePluginEntry, emptyPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";

// src/queue/index.js
import fs2 from "node:fs";
import path2 from "node:path";

// src/schema/task.js
import fs from "node:fs";
import path from "node:path";
var TaskStatus = {
  PENDING: "pending",
  CLAIMED: "claimed",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
};
var WORKSPACE_ROOT = "/mnt/d/code/m-team/workspace";
function setWorkspaceRoot(rootPath) {
  WORKSPACE_ROOT = rootPath;
}
function getTaskWorkspace(taskId) {
  return path.join(WORKSPACE_ROOT, taskId);
}
function ensureTaskWorkspace(taskId) {
  const ws = getTaskWorkspace(taskId);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}
function createTask({ description, input = {}, initiator = "ceo", priority = "normal" }) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  return {
    taskId,
    description: String(description),
    input: input || {},
    priority,
    initiator: initiator || "ceo",
    status: TaskStatus.PENDING,
    owner: null,
    createdAt: Date.now(),
    claimedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    summary: null,
    result: null
  };
}

// src/queue/index.js
var WORKSPACE_ROOT2 = "/mnt/d/code/m-team";
function setWorkspaceRoot2(root) {
  WORKSPACE_ROOT2 = root;
  setWorkspaceRoot(path2.join(root, "tasks"));
}
function getTasksDir() {
  return path2.join(WORKSPACE_ROOT2, "tasks");
}
function getQueueDir() {
  return path2.join(WORKSPACE_ROOT2, "queue");
}
function getTasksIndexPath() {
  return path2.join(getQueueDir(), "tasks.json");
}
function init() {
  fs2.mkdirSync(getTasksDir(), { recursive: true });
  fs2.mkdirSync(getQueueDir(), { recursive: true });
  const indexPath = getTasksIndexPath();
  if (!fs2.existsSync(indexPath)) {
    fs2.writeFileSync(indexPath, JSON.stringify({ tasks: [], version: 1 }, null, 2), "utf8");
  }
}
function publishTask({ description, input = {}, initiator = "ceo", priority }) {
  init();
  const task = createTask({ description, input, initiator, priority });
  const taskDir = ensureTaskWorkspace(task.taskId);
  const taskPath = path2.join(taskDir, "task.json");
  fs2.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf8");
  const index = JSON.parse(fs2.readFileSync(getTasksIndexPath(), "utf8"));
  index.tasks.push(task.taskId);
  fs2.writeFileSync(getTasksIndexPath(), JSON.stringify(index, null, 2), "utf8");
  console.log(`[m-team-queue] \u4EFB\u52A1\u53D1\u5E03: ${task.taskId} - ${description}`);
  return task.taskId;
}
function claimTask(taskId, agentId) {
  const taskDir = getTaskWorkspace(taskId);
  const taskPath = path2.join(taskDir, "task.json");
  const lockPath = path2.join(taskDir, ".lock");
  if (!fs2.existsSync(taskPath)) return false;
  try {
    fs2.writeFileSync(lockPath, agentId, { flag: "wx" });
  } catch (e) {
    if (e.code === "EEXIST") return false;
    throw e;
  }
  try {
    const task = JSON.parse(fs2.readFileSync(taskPath, "utf8"));
    if (task.status !== TaskStatus.PENDING) return false;
    task.status = TaskStatus.CLAIMED;
    task.owner = agentId;
    task.claimedAt = Date.now();
    fs2.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf8");
    console.log(`[m-team-queue] ${agentId} \u8BA4\u9886\u4E86\u4EFB\u52A1 ${taskId}`);
    return true;
  } finally {
    if (fs2.existsSync(lockPath)) fs2.unlinkSync(lockPath);
  }
}
function getPendingTasks(agentId = null) {
  init();
  const index = JSON.parse(fs2.readFileSync(getTasksIndexPath(), "utf8"));
  if (agentId && getAgentActiveTask(agentId)) return [];
  const pending = [];
  for (const tid of index.tasks) {
    const taskPath = path2.join(getTaskWorkspace(tid), "task.json");
    if (!fs2.existsSync(taskPath)) continue;
    const task = JSON.parse(fs2.readFileSync(taskPath, "utf8"));
    if (task.status !== TaskStatus.PENDING) continue;
    pending.push(task);
  }
  const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };
  return pending.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });
}
function getAgentActiveTask(agentId) {
  const index = JSON.parse(fs2.readFileSync(getTasksIndexPath(), "utf8"));
  for (const tid of index.tasks) {
    const taskPath = path2.join(getTaskWorkspace(tid), "task.json");
    if (!fs2.existsSync(taskPath)) continue;
    const task = JSON.parse(fs2.readFileSync(taskPath, "utf8"));
    if (task.owner === agentId && (task.status === TaskStatus.CLAIMED || task.status === TaskStatus.RUNNING)) {
      return task;
    }
  }
  return null;
}
function updateTask(taskId, status, result = null, summary = null, description = null, lastHeartbeatAt = null) {
  const taskPath = path2.join(getTaskWorkspace(taskId), "task.json");
  if (!fs2.existsSync(taskPath)) return null;
  const task = JSON.parse(fs2.readFileSync(taskPath, "utf8"));
  if (status) task.status = status;
  if (result) task.result = result;
  if (summary) task.summary = summary;
  if (description) task.description = description;
  if (lastHeartbeatAt) task.lastHeartbeatAt = lastHeartbeatAt;
  if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
    task.completedAt = Date.now();
  }
  if (status === TaskStatus.RUNNING && !task.lastHeartbeatAt) {
    task.lastHeartbeatAt = Date.now();
  }
  fs2.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf8");
  console.log(`[m-team-queue] \u4EFB\u52A1 ${taskId} \u72B6\u6001: ${status}`);
  return task;
}
function getTask(taskId) {
  const taskPath = path2.join(getTaskWorkspace(taskId), "task.json");
  if (!fs2.existsSync(taskPath)) return null;
  return JSON.parse(fs2.readFileSync(taskPath, "utf8"));
}
function getAllTasks() {
  init();
  const index = JSON.parse(fs2.readFileSync(getTasksIndexPath(), "utf8"));
  const tasks = [];
  for (const tid of index.tasks) {
    const task = getTask(tid);
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

// src/index.js
var DEFAULT_CONFIG = {
  workspaceRoot: null
};
var config = { ...DEFAULT_CONFIG };
function getTasksDir2() {
  return path3.join(config.workspaceRoot, "tasks");
}
function getQueueDir2() {
  return path3.join(config.workspaceRoot, "queue");
}
var index_default = definePluginEntry({
  id: "m-team",
  name: "M-Team \u53BB\u4E2D\u5FC3\u5316\u4EFB\u52A1\u6C60",
  description: "\u53BB\u4E2D\u5FC3\u5316\u4EFB\u52A1\u6C60\u534F\u4F5C\u63D2\u4EF6 \u2014 \u591AAgent\u4EFB\u52A1\u5206\u53D1\u4E0E\u6267\u884C",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    config.workspaceRoot = pluginConfig.workspaceRoot || DEFAULT_CONFIG.workspaceRoot;
    if (!config.workspaceRoot) {
      api.logger?.warn("[m-team] \u672A\u914D\u7F6E workspaceRoot\uFF0C\u8DF3\u8FC7\u521D\u59CB\u5316");
      return;
    }
    fs3.mkdirSync(config.workspaceRoot, { recursive: true });
    fs3.mkdirSync(getTasksDir2(), { recursive: true });
    fs3.mkdirSync(getQueueDir2(), { recursive: true });
    setWorkspaceRoot2(config.workspaceRoot);
    api.registerTool({
      name: "mteam_publish_task",
      description: "\u53D1\u5E03\u4EFB\u52A1\u5230\u961F\u5217",
      input: {
        type: "object",
        properties: {
          description: { type: "string", description: "\u4EFB\u52A1\u63CF\u8FF0" },
          input: { type: "object", description: "\u4EFB\u52A1\u8F93\u5165\u53C2\u6570" },
          initiator: { type: "string", description: "\u53D1\u8D77\u8005" },
          priority: { type: "string", enum: ["high", "normal", "low"], description: "\u4F18\u5148\u7EA7\uFF0C\u9ED8\u8BA4 normal" }
        },
        required: ["description"]
      },
      handler(params) {
        return { taskId: publishTask({
          description: params.description,
          input: params.input || {},
          initiator: params.initiator || "ceo",
          priority: params.priority
        }) };
      }
    });
    api.registerTool({
      name: "mteam_claim_task",
      description: "\u8BA4\u9886\u4EFB\u52A1",
      input: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "\u4EFB\u52A1ID" },
          agentId: { type: "string", description: "\u8BA4\u9886\u8005agentId" }
        },
        required: ["taskId", "agentId"]
      },
      handler(params) {
        return { claimed: claimTask(params.taskId, params.agentId), taskId: params.taskId };
      }
    });
    api.registerTool({
      name: "mteam_update_task",
      description: "\u66F4\u65B0\u4EFB\u52A1\u72B6\u6001\u6216\u5FC3\u8DF3",
      input: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "\u4EFB\u52A1ID" },
          status: { type: "string", enum: ["running", "completed", "failed", "pending"], description: "\u72B6\u6001\uFF08\u53EF\u9009\uFF0C\u4E0D\u4F20\u5219\u53EA\u66F4\u65B0\u5FC3\u8DF3\uFF09" },
          summary: { type: "string", description: "\u7ED3\u679C\u6458\u8981" },
          description: { type: "string", description: '\u65B0\u63CF\u8FF0\uFF08\u7528\u4E8E"\u9700\u4E0B\u4E00\u6B65"\u573A\u666F\uFF09' },
          result: { type: "object", description: "\u5B8C\u6574\u7ED3\u679C", properties: {} },
          lastHeartbeatAt: { type: "number", description: '\u5FC3\u8DF3\u65F6\u95F4\u6233\uFF08\u6BEB\u79D2\uFF09\uFF0Crunning \u65F6\u5B9A\u671F\u66F4\u65B0\u8868\u793A"\u8FD8\u6D3B\u7740"' }
        },
        required: ["taskId"]
      },
      handler(params) {
        return updateTask(
          params.taskId,
          params.status,
          params.result,
          params.summary,
          params.description,
          params.lastHeartbeatAt
        );
      }
    });
    api.registerTool({
      name: "mteam_get_pending",
      description: "\u83B7\u53D6\u5F85\u8BA4\u9886\u4EFB\u52A1\u5217\u8868\uFF08agent\u6709\u8FDB\u884C\u4E2D\u4EFB\u52A1\u65F6\u8FD4\u56DE\u7A7A\uFF09",
      input: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "\u8FC7\u6EE4\uFF1AagentId" }
        }
      },
      handler(params) {
        return { pending: getPendingTasks(params.agentId) };
      }
    });
    api.registerTool({
      name: "mteam_get_agent_active",
      description: "\u83B7\u53D6 agent \u5F53\u524D\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\uFF08\u4E00\u4E2A agent \u4E0D\u80FD\u540C\u65F6\u505A\u591A\u4E2A\u4EFB\u52A1\uFF09",
      input: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "agentId" }
        },
        required: ["agentId"]
      },
      handler(params) {
        return { activeTask: getAgentActiveTask(params.agentId) };
      }
    });
    api.registerTool({
      name: "mteam_get_task",
      description: "\u83B7\u53D6\u4EFB\u52A1\u8BE6\u60C5",
      input: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "\u4EFB\u52A1ID" }
        },
        required: ["taskId"]
      },
      handler(params) {
        return getTask(params.taskId);
      }
    });
    api.registerTool({
      name: "mteam_get_all_tasks",
      description: "\u83B7\u53D6\u6240\u6709\u4EFB\u52A1",
      input: { type: "object", properties: {} },
      handler() {
        return { tasks: getAllTasks() };
      }
    });
    api.logger?.info("[m-team] \u4EFB\u52A1\u6C60\u534F\u4F5C\u63D2\u4EF6\u5DF2\u6FC0\u6D3B");
    api.logger?.info(`[m-team] Workspace: ${config.workspaceRoot}`);
    api.logger?.info(`[m-team] Tasks: ${getTasksDir2()}`);
    api.logger?.info(`[m-team] Queue: ${getQueueDir2()}`);
  }
});
export {
  index_default as default
};
