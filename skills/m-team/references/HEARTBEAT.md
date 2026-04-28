# HEARTBEAT.md

## 两种情况

执行 heartbeat 检查前，先判断当前有没有任务：

```
mteam_get_agent_active()
```

- **有任务** → 执行情况 A（更新心跳）
- **无任务** → 执行情况 B（认领新任务）

---

## 情况 A：有任务时的心跳

### 第一步：更新心跳

拿到 taskId 后，调用 `mteam_update_task` 更新心跳：

```
mteam_update_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  lastHeartbeatAt: Date.now()
})
```

**心跳频率**：每 5 分钟更新一次。

### 第二步：判断是否卡住

读取当前任务的 `lastHeartbeatAt`，与当前时间比较：

- 超过 30 分钟未更新 → 任务视为**疑似僵尸**
- 超过 60 分钟未更新 → 任务判定为**已卡死**，需要介入

### 第三步：卡住时的处理

**情况 A1：Executor 仍在运行，只是没有推进**
1. `sessions_list` 找到 Executor 的当前 session
2. `sessions_send` 发消息："请继续执行当前任务，不要停留在上一步"

**情况 A2：Executor 已失联**
1. `sessions_list` 查看 session 状态
2. 通过 `mteam_relinquish_task` 把任务放回池子：

```
mteam_relinquish_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  reason: "心跳超时，任务放回池子"
})
```

---

## 情况 B：空闲时主动认领任务

如果 `mteam_get_agent_active()` 返回空数组，说明当前没有进行中的任务。

此时不要闲着，应该主动去拿任务：

### 第一步：查看待认领任务

```
mteam_get_pending()
```

返回示例：
```json
[
  {
    "taskId": "task_xyz789",
    "goal": "搜索收纳箱1688供应商",
    "priority": 5,
    "createdAt": 1745800000000
  }
]
```

### 第二步：认领任务

找到合适认领的任务后：

```
mteam_claim_task({
  taskId: "task_xyz789",
  agentId: "executor_1"
})
```

返回成功后，该任务进入 running 状态，开始执行。

### 认领策略

- 优先认领 `priority` 高的任务
- 优先认领创建时间早的任务（先发布先处理）
- 不认领与自己技能不匹配的任务（检查 goal 内容）

### 第三步：开始执行后立即更新心跳

认领成功后立即发一次心跳，证明任务已开始：

```
mteam_update_task({
  taskId: "task_xyz789",
  agentId: "executor_1",
  lastHeartbeatAt: Date.now()
})
```

---

## 关键约束

- **Publisher 不管心跳**：心跳是 Executor 的责任，Publisher 只负责发布和取消
- **心跳不等于进度**：心跳只证明 Executor 还活着，不证明任务在推进
- **真正的进度**是 context 里有 contextStep 更新
- **空闲是浪费**：没有任务时必须主动去 pending 队列认领，不等待
