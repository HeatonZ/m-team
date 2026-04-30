## Executor 心跳模板

> 框架无关通用写法。`mteam_*` 为示例工具名，实际使用时请替换为你的任务池工具。

### 架构说明

Executor 心跳 session 和执行 session 是**两个独立 session**：
- **心跳 session**：只负责 get_pending → claim_task，然后退出
- **执行 session**（由插件在 claim 后自动 spawn）：负责实际执行，完成后调用 complete/relay/relinquish

### 心跳 session 流程

```
[无任务] → get_pending → 有 → claim_task → 退出（插件自动 spawn 执行 session）
[无任务] → get_pending → 无 → 空转，退出
```

```javascript
// 从 workspace 目录名动态获取 agentId（如 workspace-maker → maker）
const myAgentId = workspace.split('/').pop().replace('workspace-', '')

// 1. 查询本 agent 是否有进行中任务
const { activeTask } = mteam_get_agent_active({ agentId: myAgentId })

if (activeTask) {
  // 2. 检查执行 session 是否真实活跃（通过 sessions_list + updatedAt）
  const { sessions } = sessions_list({ agentId: myAgentId })
  const execSession = sessions.find(s => s.key.includes(activeTask.taskId))
  const now = Date.now()
  const isSessionAlive = execSession && (now - execSession.updatedAt < 20 * 60 * 1000)

  if (isSessionAlive) {
    // session 还活着，只更新心跳
    mteam_update_task({
      taskId: activeTask.taskId,
      agentId: myAgentId,
      lastHeartbeatAt: now
    })
  } else {
    // session 已死，释放任务
    mteam_relinquish_task({ taskId: activeTask.taskId, executorId: myAgentId })
  }
} else {
  // 无进行中，去拿一个
  const { pending } = mteam_get_pending({ agentId: myAgentId })
  if (pending.length > 0) {
    // 自己判断：看每个 pending 的 goal，判断是否适合自己
    // - 读取本 agent 的 IDENTITY.md，理解自己的职责范围
    // - goal 与 IDENTITY 匹配才 claim，不匹配就跳过
    // - 若所有任务都不匹配，空转退出，不乱接
    const chosen = pending.find(t => {
      // TODO: 根据 goal 内容和本 agent 的 IDENTITY 判断是否适合
      // 示例判断逻辑（实际由 LLM 自行评估）：
      // const myRole = readIdentityRole() // 从 IDENTITY.md 读取
      // if (t.goal.includes('选品') && myRole === '跨境电商') return true
      return false // 默认不接，等 LLM 真正判断
    })
    if (chosen) {
      mteam_claim_task({ agentId: myAgentId, taskId: chosen.taskId })
    }
  }
}
// 回复 HEARTBEAT_OK
```

### 判断逻辑

| 情况 | 含义 | 操作 |
|------|------|------|
| task 有 + session 活跃 | 任务真实在跑 | 更新心跳 |
| task 有 + session 死亡 | 任务卡死，agent 还活着 | relinquish |
| task 无 + session 死亡 | OpenClaw 心跳本身卡了 | 不影响，等待下次心跳 |

### 心跳更新（只在有任务时）

```javascript
mteam_update_task({
  taskId: "{taskId}",
  agentId: myAgentId,
  lastHeartbeatAt: Date.now()
})
// 只传 taskId + agentId + lastHeartbeatAt，不传 status
```

### 注意

- 心跳 session **不**负责转 running，插件会在 claim 后自动处理
- 心跳 session **不**执行任务，只负责"抢任务"
- 心跳更新需要 `agentId`，否则 context 无法正确追加
- `myAgentId` 应从环境/workspace 动态获取，不要硬编码
- **必须用 sessions_list 检查 session updatedAt**，不能只靠 task 心跳判断任务是否真实运行
- 任务执行由独立的执行 session 负责，参考 Executor skill
