# M-Team — 任务格式与 Tool API

> 版本：2.0 | 更新：2026-04-29
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[SESSION.md](./SESSION.md)

---

## 任务格式

```json
{
  "taskId": "task_1745620000000_abc123",
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
  "lastHeartbeatAt": null
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 唯一标识，格式 `task_{timestamp}_{random}` |
| `description` | string | **当前步骤描述**，每次 relay 后更新 |
| `goal` | string | **核心目标**，创建后不可更改 |
| `context` | array | 步骤历史，数组末尾是最新的可执行状态 |
| `priority` | string | `high` / `normal` / `low` |
| `publisher` | string | 发布者身份（不做权限控制）|
| `status` | string | `pending` / `running` / `completed` / `failed` / `cancelled` |
| `executor` | string\|null | 当前持有任务的 agentId |
| `lastExecutor` | string\|null | 上一个 executor（relay 时传承）|
| `createdAt` | number | 创建时间戳（毫秒）|
| `completedAt` | number\|null | 完成时间戳 |
| `lastHeartbeatAt` | number\|null | 最近一次心跳时间戳 |

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
pending → running → completed
                        ↘ failed
                        ↘ pending（需接力，taskId 不变）
```

---

## Tool API（9 个）

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务（SQLite 事务，原子操作） |
| `mteam_update_task` | 执行者 | 更新状态/追加 context 步骤 |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | 执行者 | Executor 主动放弃（放回 pending） |
| `mteam_get_pending` | 执行者 | 获取待认领任务（agent 有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
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
// 返回: { taskId: "task_1745740800000_abc123" }
```

---

### mteam_claim_task

认领一个 pending 任务，同时在 Plugin 内部创建 Executor Session。

```javascript
mteam_claim_task({
  taskId: "task_1745740800000_abc123",
  agentId: "my-agent-id"
})
/**
 * 返回:
 * {
 *   success: true,
 *   taskId: "task_1745740800000_abc123",
 *   task: { ... },
 *   runId: "run_xxx",
 *   sessionKey: "mteam:task1745740800000_abc123:my-agent-id:1745740801234"
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

更新任务状态、追加 context 步骤、或只更新心跳。

```javascript
// 完成任务
mteam_update_task({
  taskId: "task_1745740800000_abc123",
  status: "completed",
  contextStep: "联系供应商确认价格",
  contextOutput: {
    summary: "联系了5家，3家回复",
    files: ["data/contact_log.md"]
  }
})

// 接力：需要下一步，放回池子
mteam_update_task({
  taskId: "task_xxx",
  status: "pending",           // 放回 pending
  contextStep: "整理报价单",
  contextOutput: { summary: "整理了报价对比", files: ["data/quotes.xlsx"] },
  description: "向客户发送最终报价"  // 下一步做什么
})

// 只更新心跳
mteam_update_task({
  taskId: "task_xxx",
  lastHeartbeatAt: Date.now()
})
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

**约束**：只能是当前 `executor` 才能 relinquish。如果 executor session 已经结束（超时/崩溃），由 Heartbeat Session 通过 `lastHeartbeatAt` 检测僵尸任务，下一轮自行 relinquish。

---

### 查询类工具

```javascript
// 获取待认领任务（最多 3 条，agent 有 running 任务时返回空）
mteam_get_pending({ agentId: "my-agent" })
// 返回: { pending: [...] }

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
