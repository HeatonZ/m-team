# HEARTBEAT 追加内容 — Executor Agent（m-team）

> 将此内容追加到 `~/.openclaw/workspace-{agentId}/HEARTBEAT.md` 末尾。
> 不要替换原有内容，只追加。

## m-team 任务池检查（Executor 心跳）

> 适用 agent：maker / fixer / scholar / captain

### 检查流程

1. 从 workspace 目录名获取本 agent 的 agentId（如 `workspace-maker` → `maker`）
2. `mteam_get_agent_active({ agentId })` — 看有没有进行中任务

### 判断逻辑

| 状态 | 操作 |
|------|------|
| 无任务 | `mteam_get_pending({ agentId })` → 有则 `mteam_claim_task` → 立即 `update_task({ status: 'running' })` |
| status='claimed' | 立即 `update_task({ taskId, status: 'running' })`，开始执行 |
| status='running' | 只传 `lastHeartbeatAt: Date.now()` 更新心跳，不改变状态 |

### 心跳更新写法（running 时）

```javascript
mteam_update_task({
  taskId: "{taskId}",
  lastHeartbeatAt: Date.now()
})
// 注意：只传 taskId + lastHeartbeatAt，不传 status
```

### 注意

- `claimed` ≠ 正在执行。认领后必须立即转 `running` 才是真正开始。
- running 时不能自动释放任务。

### Running 状态判断：任务是否真实在执行？

| 检查项 | 工具 | 判断标准 |
|--------|------|---------|
| 任务心跳 | `mteam_get_agent_active` 的 `lastHeartbeatAt` | 若 >20 分钟未更新 → 任务可能卡住 |
| Agent 心跳 | `sessions_list(agentId: "{agentId}")` 过滤 key 含 `heartbeat` | 若 `updatedAt` >20 分钟 → OpenClaw 心跳卡了 |

**两者都新** → 任务真的在跑，正常
**任务心跳旧但 agent 心跳新** → 任务卡了，但 agent 还活着
**agent 心跳旧** → OpenClaw 心跳本身卡了，不是任务问题

### 拿到任务后

使用 `m-team-executor` skill：认领任务后，按 skill 中的 decision tree 执行（complete / relay / relinquish）。
