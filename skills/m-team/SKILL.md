# M-Team 任务队列

## 角色定位

你是 M-Team 去中心化任务池的一员。根据你的角色执行对应操作。

---

## 你的角色

**孔明（publisher）** — 确认需求后发布任务到队列
**执行者（captain/maker/scholar）** — 心跳时检查队列，认领并执行任务

---

## 工具列表

| 工具 | 角色 | 用途 |
|------|------|------|
| `mteam_publish_task` | 孔明 | 发布任务 |
| `mteam_claim_task` | 执行者 | 认领任务 |
| `mteam_update_task` | 执行者 | 更新状态 |
| `mteam_get_pending` | 执行者 | 查看待认领任务 |
| `mteam_get_agent_active` | 执行者 | 查看自己进行中的任务 |
| `mteam_get_task` | 执行者 | 查看任务详情 |
| `mteam_get_all_tasks` | 任意 | 查看所有任务 |

---

## 孔明流程

### 1. 确认需求

跟 CEO 确认需求细节。

### 2. 发布任务

```
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
  requiredCapability: "captain",
  input: { keyword: "收纳箱", count: 10 },
  initiator: "ceo"
})
```

### 3. 通知 CEO

群里发：
```
📋 任务已发布
描述: {description}
执行者: {requiredCapability}
等待认领...
```

---

## 执行者 HEARTBEAT 配置

执行者（captain/maker/scholar）需要在 HEARTBEAT.md 中加入任务池检查。以下是模板：

### captain 的 HEARTBEAT.md 增加：

```markdown
## 任务池检查
- [ ] 使用 mteam_get_agent_active 检查自己是否有进行中任务
- [ ] 有任务且 status='claimed' → 立即 mteam_update_task({ status: 'running' }) 真正开始执行
- [ ] 有任务且 status='running' → 跳过（正在执行中）
- [ ] 无任务 → mteam_get_pending 抢新任务
```

### maker 的 HEARTBEAT.md 增加：

```markdown
## 任务池检查
- [ ] 使用 mteam_get_agent_active 检查自己是否有进行中任务
- [ ] 有任务且 status='claimed' → 立即 mteam_update_task({ status: 'running' }) 真正开始执行
- [ ] 有任务且 status='running' → 跳过（正在执行中）
- [ ] 无任务 → mteam_get_pending 抢新任务
```

### scholar 的 HEARTBEAT.md 增加：

```markdown
## 任务池检查
- [ ] 使用 mteam_get_agent_active 检查自己是否有进行中任务
- [ ] 有任务且 status='claimed' → 立即 mteam_update_task({ status: 'running' }) 真正开始执行
- [ ] 有任务且 status='running' → 跳过（正在执行中）
- [ ] 无任务 → mteam_get_pending 抢新任务
```

**注意：** `claimed` ≠ 正在执行。认领后必须立即转 `running` 才是真正开始。

---

## 执行者流程

### 状态说明

| 状态 | 含义 |
|------|------|
| `pending` | 待认领，没人抢 |
| `claimed` | 已认领，还没开始执行 |
| `running` | 正在执行 |
| `completed` | 已完成 |
| `failed` | 失败 |

**`claimed` 不等于正在执行！** 认领后必须立即转 `running` 并初始化心跳。

### 状态与心跳

| 状态 | 含义 | 心跳要求 |
|------|------|---------|
| `claimed` | 已认领，还没开始执行 | 立即转 `running` |
| `running` | 正在执行 | 定期更新 `lastHeartbeatAt` |
| `completed` | 已完成 | 无 |
| `failed` | 失败 | 无 |

**心跳阈值：** `lastHeartbeatAt` 超过 30 分钟未更新，任务视为疑似僵尸。

### 1. 心跳时检查自己

```
mteam_get_agent_active({ agentId: "你的agentId" })
```

返回内容：
```json
{
  "taskId": "task_xxx",
  "status": "running",
  "lastHeartbeatAt": 1745740800000,
  "description": "...",
  "input": {...}
}
```

### 2. 判断逻辑

- **有任务 + `status='claimed'`** → 立即 `update_task({ status: 'running' })`，开始执行
- **有任务 + `status='running'`** → 检查 `lastHeartbeatAt`：
  - 超过 30 分钟未更新 → `update_task({ status: 'pending' })` 释放任务，重新抢
  - 30 分钟内 → 执行中，继续
- **无任务** → 第 3 步抢新任务

### 3. 执行中定期更新心跳

正在执行时，每完成一个子步骤，调用：

```
mteam_update_task({
  taskId: "{taskId}",
  lastHeartbeatAt: Date.now()
})
```

只传 `taskId` + `lastHeartbeatAt`，不传 `status`，表示"我还活着"。

### 4. 抢新任务

```
mteam_get_pending({ agentId: "你的agentId" })
```

有任务？→ `claim_task` → 认领后立即 `update_task({ status: 'running' })` → 执行

### 4. 执行任务

根据 `description` 和 `input` 执行。

### 5. 写入产出

产出写入任务文件夹：`/mnt/d/code/m-team/tasks/{taskId}/`

```
/mnt/d/code/m-team/tasks/{taskId}/
├── task.json       # 任务详情（只读）
├── result.json     # 执行结果
└── {产出文件}     # 其他产出
```

### 6. 更新状态

```
mteam_update_task({
  taskId: "{taskId}",
  status: "completed",
  summary: "找到10个供应商"
})
```

### 7. 群里回报

```
✅ 任务完成 [{taskId}]
摘要: {summary}
```

---

## 错误处理

- 失败：`mteam_update_task({ taskId, status: "failed", summary: "失败原因" })`
- 不要让任务卡在 claimed/running

---

## 重要原则

1. **按角色办事** — 你是什么角色就做什么事
2. **产出写任务文件夹** — 不散落
3. **完成后更新状态** — 让系统知道任务已结束
