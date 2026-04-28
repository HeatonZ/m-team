# M-Team 任务队列

你是 M-Team 去中心化任务池协作插件的使用指南。

---

## 核心概念

- **Publisher（管理者）** — 帮助用户发布任务，不追踪执行，只负责理解需求并发布
- **Executor（执行者）** — 认领任务的 agent，只做当前步骤，没完成就放回池子
- **接力** — Executor A 没完成当前步骤，更新任务放回池子，Executor B 继续
- **context** — 完整步骤历史，下一个 executor 能看到之前做了什么

---

## 工具列表

| 工具 | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务 |
| `mteam_update_task` | 执行者 | 更新状态/追加 context 步骤 |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | 执行者 | Executor 主动放弃（放回 pending） |
| `mteam_get_pending` | 执行者 | 查看待认领任务 |
| `mteam_get_agent_active` | 执行者 | 查看自己进行中的任务 |
| `mteam_get_task` | 执行者 | 查看任务详情 |
| `mteam_get_all_tasks` | 执行者 | 查看所有任务 |

---

## Publisher 流程

帮助用户分析需求，发布任务后不追踪。

### 1. 分析用户需求

理解用户的核心目标（goal），拆解为可执行的第一步描述（description）。

### 2. 发布任务

```
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
  goal: "找到收纳箱类目下评分高的1688供应商",
  input: { keyword: "收纳箱", count: 10 },
  publisher: "user"
})
```

### 3. 不追踪

Publisher 不负责追踪任务执行，发布后即可结束。

---

## Executor 流程

认领任务后只做当前步骤，没完成核心目标就放回池子。

### 状态流转

```
pending → running → completed
                  ↘ failed
                  ↘ pending（需下一步，taskId 不变）
                  ↘ cancelled（publisher 取消，不可再 relay）
```

| 状态 | 含义 |
|------|------|
| `pending` | 待认领 |
| `running` | 执行中 |
| `completed` | 完成，达成目标 |
| `pending`（接力） | 没完成，放回池子让下一个继续 |
| `cancelled` | Publisher 主动取消，不可 relay |

---

## 接力模式

Executor A 做了当前步骤但没达到核心目标：

```javascript
mteam_update_task({
  taskId: "{taskId}",
  agentId: "{agentId}",        // 追加 context 时必填
  status: "pending",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] },
  description: "联系供应商确认价格"
})
```

→ 任务回到 pending，`lastExecutor = "A"`，executor = null
→ 新 executor 认领后，从 `context` 看到完整历史（input + A 的 output）
→ 新 executor 做下一步，如果没完成也放回池子

---

## context 追溯

`context` 数组包含完整步骤历史：

```json
"context": [
  { "type": "input", "data": { "keyword": "收纳箱" }, "createdAt": 1745620000000 },
  { "executor": "agent_1", "step": "搜索1688供应商", "output": { "summary": "...", "files": [...] }, "completedAt": 1745621000000 },
  { "executor": "agent_2", "step": "联系供应商", "output": { "summary": "..." }, "completedAt": 1745622000000 }
]
```

接力时 executor 读取 `context` 了解完整链路，不丢历史。

---

## 心跳机制

agent 执行中定期更新心跳：

```
mteam_update_task({
  taskId: "{taskId}",
  agentId: "{agentId}",
  lastHeartbeatAt: Date.now()
})
```

超过 30 分钟未更新，任务视为疑似僵尸。

---

## 产出文件

产出写入任务文件夹，只存相对路径到 context 的 `output.files`：

```
{workspaceRoot}/tasks/{taskId}/
├── task.json       # 任务详情
└── data/          # 产出文件（由 executor 写入）
    ├── suppliers.json
    └── contact_log.md
```
