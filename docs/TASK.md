# M-Team — 任务格式与 Tool API

> 版本：2.1 | 更新：2026-04-29
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[SESSION.md](./SESSION.md)

---

## 任务格式

```json
{
  "taskId": "task_1745620000",
  "description": "联系供应商确认价格",
  "goal": "找到收纳箱类目下评分高的1688供应商",
  "context": [
    { "type": "input", "data": { "keyword": "收纳箱", "count": 10 }, "createdAt": 1745620000000 },
    { "executor": "agent_1", "step": "搜索1688供应商", "output": { "summary": "找到10家供应商", "files": ["data/suppliers_001.json"] }, "completedAt": 1745621000000 },
    { "executor": "agent_2", "step": "联系供应商确认价格", "output": { "summary": "联系了5家，3家回复" }, "completedAt": 1745622000000 }
  ],
  "priority": "high",
  "publisher": "user",
  "status": "pending",
  "executor": null,
  "lastExecutor": "agent_2",
  "createdAt": 1745620000000,
  "completedAt": null,
  "updatedAt": 1745620000000,
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 唯一标识，格式 `task_{unix_timestamp}`（秒级） |
| `description` | string | **当前步骤描述**，每次 relay 后更新 |
| `goal` | string | **核心目标**，创建后不可更改 |
| `context` | array | 步骤历史，数组末尾是最新的可执行状态 |
| `priority` | string | `high` / `normal` / `low` |
| `publisher` | string | 发布者身份（不做权限控制）|
| `status` | string | `pending` / `running` / `completed` / `closed` / `failed` / `cancelled` |
| `executor` | string\|null | 当前持有任务的 agentId |
| `lastExecutor` | string\|null | 上一个 executor（relay 时传承）|
| `createdAt` | number | 创建时间戳（毫秒）|
| `completedAt` | number\|null | 完成时间戳 |
| `updatedAt` | number | 最后更新时间戳 |

### context 格式说明

| 字段 | 说明 |
|------|------|
| `context[0].type` | 固定为 `"input"`，创建后不可更改 |
| `context[0].data` | 原始输入，任意结构 |
| `context[].executor` | 执行该步骤的 agentId |
| `context[].step` | 步骤描述 |
| `context[].output.summary` | 步骤摘要，建议简洁 |
| `context[].output.files` | 任务文件夹内的相对路径，原始数据放文件里 |
| `context[].completedAt` | 步骤完成时间戳 |

### 状态流转

```
PENDING ──claim──► RUNNING ──complete──► COMPLETED ──close──► CLOSED（终态）
    ▲                       │
    │ relay                 │ fail（subagent_ended hook 触发）
    └──relinquish──────────►FAILED
```

---

## Tool API（12 个）

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务（SQLite 事务，原子操作） |
| `mteam_update_task` | 执行者 | 只更新心跳或追加 context |
| `mteam_complete_task` | 执行者 | 完成任务，标记 completed |
| `mteam_relay_task` | 执行者 | 接力，追加 context 后变回 pending |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | 执行者 | 主动放弃（放回 pending） |
| `mteam_get_pending` | 执行者 | 获取待认领任务（agent 有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_close_task` | Publisher | Publisher 验收通过，关闭任务（终态） |
| `mteam_get_all_tasks` | 执行者 | 获取所有任务 |

---

## 工具详解

### mteam_publish_task

发布新任务到任务池。

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商",      // 第一步描述
  goal: "找到收纳箱类目下评分高的1688供应商", // 核心目标，不可更改
  input: { keyword: "收纳箱", count: 10 },   // 原始输入
  publisher: "user",                          // 发布者身份
  priority: "high"                            // high / normal / low
})
// 返回: { taskId: "task_1745740800" }
```

---

### mteam_claim_task

认领一个 pending 任务，同时在 Plugin 内部创建 Executor Session。

```javascript
mteam_claim_task({
  taskId: "task_1745740800",
  agentId: "my-agent-id"
})
/**
 * 返回:
 * {
 *   success: true,
 *   taskId: "task_1745740800",
 *   task: { ... },
 *   runId: "run_xxx",
 *   sessionKey: "agent:my-agent-id:m-team:task1745740800"
 * }
 *
 * SQLite 事务:
 *   BEGIN IMMEDIATE;
 *   SELECT * FROM tasks WHERE task_id=? AND status='pending';
 *   UPDATE tasks SET status='running', executor=?, ... WHERE task_id=?;
 *   COMMIT;
 */
```

---

### mteam_update_task

只更新心跳或追加 context 步骤。**不**用于完成或 relay。

```javascript
// 只更新 updatedAt
mteam_update_task({
  taskId: "task_xxx",
  agentId: "maker",
  updatedAt: Date.now()
})

// Executor 追加 context 步骤（配合 complete/relay 使用，由 executor session 调用）
mteam_update_task({
  taskId: "task_xxx",
  agentId: "maker",
  contextStep: "联系供应商确认价格",
  contextOutput: {
    summary: "联系了5家，3家回复",
    files: ["data/contact_log.md"]
  }
})
```

**注意**：`status` 字段不再由外部调用控制。完成用 `mteam_complete_task`，接力用 `mteam_relay_task`。

---

### mteam_complete_task

Executor 完成任务，标记 `completed`，发送通知。

```javascript
mteam_complete_task({
  taskId: "task_xxx",
  contextStep: "搜索1688供应商",
  contextOutput: {
    summary: "找到10家供应商",
    files: ["data/suppliers.json"]
  }
})
// 返回: { success: true, task: { ... } }
```

---

### mteam_relay_task

Executor 完成当前步骤并交接给下一个 agent。追加 context 后任务变回 `pending`。

```javascript
mteam_relay_task({
  taskId: "task_xxx",
  agentId: "maker",
  contextStep: "搜索1688供应商",
  contextOutput: {
    summary: "找到10家供应商",
    files: ["data/suppliers.json"]
  },
  description: "联系供应商询价"
})
// 返回: { success: true, task: { ... } }
// 调用后 status → pending，executor → null，description 更新，context 追加当前步骤
```

---

### mteam_cancel_task

Publisher 取消任务。取消后任务进入 `cancelled` 状态，不可 relay。

```javascript
mteam_cancel_task({
  taskId: "task_xxx",
  publisher: "user",
  reason: "需求变更"
})
```

**注意**：只有任务的原始 `publisher` 才能取消。`cancelled` 状态的任务可以被 `updateTask` 追加 context（用于记录取消原因），但不能进入 `running` 状态。

---

### mteam_relinquish_task

Executor 主动放弃当前任务（放回 pending），供其他 agent 接力。

```javascript
mteam_relinquish_task({
  taskId: "task_xxx",
  executorId: "agent_1"
})
// 调用后 status → pending，executor → null，lastExecutor → "agent_1"
```

**两种 relinquish 场景**：
- **Executor session 主动放弃**：自己判断无法完成，调用 `relinquish_task({ executorId: "maker" })`
- **Heartbeat session 检测到 executor session 已死**：通过 sessions_list 检查 updatedAt 超过 20 分钟，主动调用 `relinquish_task` 释放任务

---

### 查询类工具

```javascript
// 获取待认领任务（最多 3 条，agent 有 running 任务时返回空）
// 注意：返回的 task 不含 goal，认领时只看 description
mteam_get_pending({ agentId: "my-agent" })
// 返回: { pending: [{ taskId, description, priority, context, ... }] }

// 获取 agent 当前进行中任务
mteam_get_agent_active({ agentId: "my-agent" })
// 返回: { activeTask: null | { taskId, status, ... } }

// 获取单个任务详情
mteam_get_task({ taskId: "task_xxx" })
// 返回: { task: { ... } }

// 获取所有任务
mteam_get_all_tasks({})
// 返回: { tasks: [...] }
```

---

### mteam_close_task

Publisher 验收 Executor 完成的任务。通过后任务进入 `closed` 终态。

```javascript
mteam_close_task({
  taskId: "task_xxx",
  publisher: "user"    // 必须与创建时 publisher 一致
})
// 返回: { success: true, task: { ..., status: "closed" } }
```

**验收流程**：
1. Executor 完成任务 → `completed`
2. Publisher 心跳检测到 COMPLETED 任务 → 注入验收 prompt
3. Publisher 判断通过 → `mteam_close_task` → `closed`
4. Publisher 判断驳回 → `mteam_update_task({ status: pending, contextStep: "驳回原因", description: "下一步要求" })` → `pending`

**注意**：`closed` 是终态，不可逆。

## 并发竞态保护

`claimTask` 使用 SQLite `BEGIN IMMEDIATE` 事务：

```sql
BEGIN IMMEDIATE;  -- 获取写锁，其他连接无法同时写
SELECT * FROM tasks WHERE task_id = ? AND status = 'pending';
-- 有结果 → UPDATE tasks SET status='running', executor=?, ... WHERE task_id=?;
-- 无结果 → ROLLBACK;
COMMIT;
```

`BEGIN IMMEDIATE` 在开始时即获取写锁，如果锁被占用则直接失败，保证只有一个 agent 能认领同一任务。
