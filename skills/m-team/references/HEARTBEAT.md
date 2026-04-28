# HEARTBEAT.md

## 用途

Executor 在执行任务过程中，定期更新心跳，证明任务仍在推进而非卡死。

---

## 第一步：找到当前任务 ID

调用 `mteam_get_agent_active()`，返回自己正在进行（status: running 或 pending 且有 executor）的任务列表：

```
mteam_get_agent_active()
```

返回示例：
```json
[
  {
    "taskId": "task_abc123",
    "status": "running",
    "goal": "搜索收纳箱1688供应商",
    "lastHeartbeatAt": 1745800000000
  }
]
```

如果返回空数组，说明当前没有进行中的任务，不需要心跳。

---

## 第二步：更新心跳

拿到 taskId 后，调用 `mteam_update_task` 更新心跳：

```
mteam_update_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  lastHeartbeatAt: Date.now()
})
```

**心跳频率**：每 5 分钟更新一次。不要频繁调用（每次 API 调用都消耗 token）。

---

## 第三步：判断任务是否卡住

读取当前任务的 `lastHeartbeatAt`，与当前时间比较：

- 超过 30 分钟未更新 → 任务视为**疑似僵尸**
- 超过 60 分钟未更新 → 任务判定为**已卡死**，需要介入

---

## 第四步：任务卡住时的处理

如果发现任务疑似僵尸或卡死：

### 情况 A：Executor 仍在运行，只是没有推进
1. `sessions_list` 找到 Executor 的当前 session
2. `sessions_send` 发消息："请继续执行当前任务，不要停留在上一步"

### 情况 B：Executor 已失联（长时间无响应）
1. `sessions_list` 查看 session 状态
2. 如果 session 已死，通过 `mteam_relinquish_task` 把任务放回池子：

```
mteam_relinquish_task({
  taskId: "task_abc123",
  agentId: "executor_1",
  reason: "心跳超时，任务放回池子"
})
```

3. 等待新的 Executor 认领

---

## 关键约束

- **Publisher 不管心跳**：心跳是 Executor 的责任，Publisher 只负责发布和取消
- **心跳不等于进度**：心跳只证明 Executor 还活着，不证明任务在推进
- **真正的进度**是 context 里的 contextStep 有更新
