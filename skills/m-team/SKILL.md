# M-Team 任务队列

你是 M-Team 去中心化任务池协作插件的使用指南。

---

## 核心概念

- **Publisher** — 帮助用户发布任务，不追踪执行，只负责理解需求并发布
- **Executor** — 认领任务的 agent，只做当前步骤，没完成就放回池子
- **接力** — Executor A 没完成当前步骤，更新任务放回池子，Executor B 继续

---

## 工具列表

| 工具 | 说明 |
|------|------|
| `mteam_publish_task` | 发布任务 |
| `mteam_claim_task` | 认领任务 |
| `mteam_update_task` | 更新状态/心跳 |
| `mteam_get_pending` | 查看待认领任务 |
| `mteam_get_agent_active` | 查看自己进行中的任务 |
| `mteam_get_task` | 查看任务详情 |
| `mteam_get_all_tasks` | 查看所有任务 |

---

## Publisher 流程

帮助用户分析需求，发布任务后不追踪。

### 1. 分析用户需求

理解用户的核心目标，拆解为可执行的任务描述。

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
pending → claimed → running → completed
                          ↘ failed
                          ↘ pending（没完成，放回池子接力）
```

| 状态 | 含义 |
|------|------|
| `pending` | 待认领 |
| `claimed` | 已认领（必须立即转 running） |
| `running` | 执行中 |
| `completed` | 完成，达成目标 |
| `pending`（接力） | 没完成，放回池子让下一个继续 |

---

## 接力模式

Executor A 做了当前步骤但没达到核心目标：

```
mteam_update_task({
  taskId: "{taskId}",
  status: "pending",
  summary: "已完成第1步，第2步需要xxx",
  result: { step1_done: true, next_needed: "xxx" }
})
```

→ 任务回到 pending，`lastExecutor = "A"`，`executor = null`
→ Executor B 认领，从 `lastExecutor` 可看到上一个是谁
→ Executor B 做当前步骤，如果没完成也放回池子

---

## 心跳机制

agent 执行中定期更新心跳：

```
mteam_update_task({
  taskId: "{taskId}",
  lastHeartbeatAt: Date.now()
})
```

超过 30 分钟未更新，任务视为疑似僵尸。

---

## 产出文件

产出写入任务文件夹：

```
{workspaceRoot}/tasks/{taskId}/
├── task.json       # 任务详情
└── {产出文件}      # 其他产出
```
