# HEARTBEAT.md

## 两种情况

执行 heartbeat 检查前，先判断当前有没有任务：

```
mteam_get_agent_active()
```

- **有任务** → 执行情况 A（更新心跳 + 真实性校验）
- **无任务** → 执行情况 B（认领新任务）

---

## 情况 A：有任务时的心跳与真实性校验

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

### 第二步：真实性校验（双重判断）

必须同时检查两个时间戳：

| 信号 | `lastHeartbeatAt` | session `updatedAt` | 判定 | 处理 |
|------|-------------------|---------------------|------|------|
| 正常 | < 30分钟 | < 5分钟 | 正常运行 | 继续执行 |
| 疑似僵尸 | < 30分钟 | > 5分钟无更新 | **谎报心跳** | 发消息 nudge 或放回池子 |
| 任务卡住 | 30分钟~60分钟 | 任意 | 执行中断 | 发消息 nudge |
| 已卡死 | > 60分钟 | 任意 | 完全失联 | 放回池子 |

**session updatedAt 查询**：

```
sessions_list()
```

返回的 session 列表中找到当前 Executor 的 session，比对其 `updatedAt` 与当前时间。

**交叉判断原则**：
- `lastHeartbeatAt` 新但 session `updatedAt` 旧 → agent 在谎报，任务实际没推进
- 两者都旧 → agent 真的停了，没有在执行

### 第三步：卡住时的处理

**情况 A1：Executor 仍在运行，只是没有推进（nudge）**
1. `sessions_list` 找到 Executor 的当前 session
2. `sessions_send` 发消息："请继续执行当前任务，不要停留在上一步"

**情况 A2：Executor 已失联（放回池子）**
1. `sessions_list` 查看 session 状态，确认已死
2. 通过 `mteam_relinquish_task` 把任务放回池子：

```
mteam_relinquish_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  reason: "心跳超时且 session 已失联，任务放回池子"
})
```

---

## 情况 B：空闲时主动认领任务

如果 `mteam_get_agent_active()` 返回空数组，说明当前没有进行中的任务。

### 第一步：查看待认领任务

```
mteam_get_pending()
```

### 第二步：认领任务

```
mteam_claim_task({
  taskId: "task_xyz789",
  agentId: "executor_1"
})
```

### 认领策略

- 优先认领 `priority` 高的任务
- 优先认领创建时间早的任务
- 不认领与自己技能不匹配的任务

### 第三步：开始执行后立即更新心跳

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
- **真正的进度**是 context 有 contextStep 更新
- **空闲是浪费**：没有任务时必须主动去 pending 队列认领，不等待
- **双重校验**：必须用 session `updatedAt` 交叉验证 `lastHeartbeatAt`，防止谎报
