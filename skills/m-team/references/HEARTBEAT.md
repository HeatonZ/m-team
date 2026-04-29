# HEARTBEAT.md

## 两种情况

执行 heartbeat 检查前，先判断当前有没有任务：

```
mteam_get_agent_active()
```

- **有任务** → 执行情况 A（校验 + 更新心跳）
- **无任务** → 执行情况 B（认领新任务）

---

## 情况 A：有任务时的心跳与真实性校验

### 第一步：找到当前 session

sessionKey 格式：`mteam:{taskId}:{随机后缀}`

用 `sessions_list` 按 `agentId` 过滤，找到当前 agent 的所有 session，从 sessionKey 中解析出 taskId，匹配当前任务：

```
sessions_list(agentId: "executor_1")
```

返回示例：
```json
[
  { "sessionKey": "mteam:task_xyz789:abc123", "updatedAt": 1745800100000 },
  { "sessionKey": "mteam:task_uvw123:def456", "updatedAt": 1745799900000 }
]
```

解析 sessionKey：前缀 `mteam:` + 中间的 taskId 部分即为关联任务。

### 第二步：交叉判断（双重校验）

| 信号 | `lastHeartbeatAt` | session `updatedAt` | 判定 | 处理 |
|------|-------------------|---------------------|------|------|
| 正常 | < 30分钟 | < 5分钟 | 正常运行 | 继续执行 |
| 疑似僵尸 | < 30分钟 | > 5分钟无更新 | **谎报心跳** | nudge 或放回池子 |
| 任务卡住 | 30分钟~60分钟 | 任意 | 执行中断 | 发消息 nudge |
| 已卡死 | > 60分钟 | 任意 | 完全失联 | 放回池子 |

**交叉判断原则**：
- `lastHeartbeatAt` 新但 session `updatedAt` 旧 → agent 在谎报，任务实际没推进
- 两者都旧 → agent 真的停了

### 第三步：更新心跳

```
mteam_update_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  lastHeartbeatAt: Date.now()
})
```

**心跳频率**：每 5 分钟更新一次。

### 第四步：卡住时的处理

**A1：Executor 还在跑，只是卡住（nudge）**
```
sessions_send(sessionKey: "mteam:task_abc123:abc123", message: "请继续执行当前任务，不要停留在上一步")
```

**A2：Executor 已失联（放回池子）**
```
mteam_relinquish_task({
  taskId: "task_abc123",
  executorId: "executor_1",
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

### 第三步：立即 spawn 执行 session

认领成功后立即 spawn session，**关键：sessionKey 必须以 `mteam:{taskId}:` 开头**：

```
sessions_spawn(
  task: "执行任务：{goal}。当前步骤：{description}。参考 context 历史。",
  agentId: "executor_1",
  sessionKey: "mteam:task_xyz789:{随机后缀}",
  mode: "run",
  runtime: "subagent"
)
```

**sessionKey 格式必须为 `mteam:{taskId}:{随机后缀}`**，这样心跳时从 sessionKey 就能直接解析出 taskId，无需额外查询 label。

### 认领策略

- 优先认领 `priority` 高的任务
- 优先认领创建时间早的任务
- 不认领与自己技能不匹配的任务

### 第四步：认领成功后立即发心跳

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
- **sessionKey 格式**：`mteam:{taskId}:{随机后缀}`，心跳时直接解析，无需 label 匹配
