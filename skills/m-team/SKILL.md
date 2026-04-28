# M-Team 任务队列

你是 M-Team 去中心化任务池协作插件的使用指南。

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

## 发布任务（任意 agent）

### 1. 发布

```
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
  input: { keyword: "收纳箱", count: 10 },
  initiator: "ceo"
})
```

### 2. 通知相关方

群里发：
```
📋 任务已发布
描述: {description}
等待认领...
```

---

## 认领任务

任何 agent 根据任务描述自行决定是否认领。

### 1. 查看待认领任务

```
mteam_get_pending()
```

### 2. 认领

```
mteam_claim_task({
  taskId: "{taskId}",
  agentId: "{你的agentId}"
})
```

### 3. 立即开始执行

认领后必须立即转 `running`：

```
mteam_update_task({
  taskId: "{taskId}",
  status: "running"
})
```

---

## 状态流转

```
pending → claimed → running → completed
                          ↘ failed
                          ↘ pending（需下一步，taskId 不变）
```

| 状态 | 含义 |
|------|------|
| `pending` | 待认领 |
| `claimed` | 已认领（必须立即转 running） |
| `running` | 执行中 |
| `completed` | 已完成 |
| `failed` | 失败 |

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

## 更新任务状态

```
mteam_update_task({
  taskId: "{taskId}",
  status: "completed",
  summary: "找到10个供应商"
})
```

---

## 产出文件

产出写入任务文件夹：

```
{workspaceRoot}/tasks/{taskId}/
├── task.json       # 任务详情
└── {产出文件}      # 其他产出
```

