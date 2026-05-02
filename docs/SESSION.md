# M-Team — 双 Session 模型

> 版本：2.1 | 更新：2026-04-29
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[TASK.md](./TASK.md)

---

## 两个 Session

M-Team 使用两个独立的 OpenClaw Session，它们之间没有任何消息传递机制：

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、维护心跳、认领任务 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部通过 `api.runtime.subagent.run()` 创建 | 实际执行任务 | 任务级 |

---

## Session 职责

### Heartbeat Session

由 HEARTBEAT 模板定期触发，每次心跳执行以下逻辑：

```
1. mteam_get_agent_active({ agentId })
   └── 有 running 任务
       ├── sessions_list 找到对应执行 session
       ├── session.updatedAt < 20 min → mteam_update_task({ lastHeartbeatAt }) → 结束
       └── session 已死 → mteam_relinquish_task → 结束
2. 无 running 任务 → mteam_get_pending({ agentId })
   └── 有待认领 → mteam_claim_task → 插件自动 spawn 执行 session
3. 继续等待下一轮心跳
```

### Executor Session

由 `mteam_claim_task` 在 claim 成功后内部创建，sessionKey 格式为：

```
agent:{agentId}:m-team:{taskId}
```

- `taskId`：任务 ID
- `agentId`：认领该任务的 agent
- `timestamp`：创建时间戳（毫秒），保证 relay 后重新 claim 不会 sessionKey 冲突

Executor Session 独立运行，**不占用 Heartbeat Session**。

---

## subagent_ended Hook

Executor Session 结束时，Plugin 自动处理：

```javascript
// hooks/subagentEnded.js
api.on('subagent_ended', async (event) => {
  const { targetSessionKey, outcome, error } = event;

  // 只处理 mteam: 前缀的 session
  if (!targetSessionKey?.startsWith('agent:') || !targetSessionKey?.includes(':m-team:')) return;
  const parts = targetSessionKey.split(':');
  const taskId = parts[3];

  if (outcome === 'ok' || outcome === 'reset') {
    completeTask(taskId);
  } else {
    failTask(taskId, error || outcome);
  }
});
```

**结果**：

| outcome | 动作 |
|---------|------|
| `ok` | `completeTask(taskId)` — 标记完成 |
| `reset` | `completeTask(taskId)` — 标记完成（正常结束）|
| 其他 | `failTask(taskId, errorMsg)` — 标记失败 |

**好处**：
- executor 不需要主动调 `mteam_update_task({ status: 'completed' })`
- 即使 executor 崩溃/超时未清理，hook 也能感知 session 结束并处理
- relay 后旧 session 结束时检测到任务已非 `running`，跳过处理（幂等）

---

## 完整时序

```
时间线            Heartbeat Session              Executor Session
─────────         ──────────────────            ─────────────────

T0                mteam_claim_task()
                    ├─ claimTask() (SQLite)
                    └─ api.runtime.subagent.run()
                         sessionKey="agent:agent1:m-team:task123"
                         message="[M-Team Task...]"
                    ←─ 立即返回 runId/sessionKey
                  return { success, taskId, runId, sessionKey }

T1                mteam_update_task             [executor 启动]
                  ({ lastHeartbeatAt })

T2                mteam_update_task             [executor 跑任务]
                  ({ lastHeartbeatAt })
                       ...

Tn                                             [executor 完成任务]
                                             subagent_ended hook
                                               → completeTask(taskId)
                                             session 关闭

Tn+1              mteam_get_agent_active()      [session 已关闭]
                    → status=completed
                    → 本轮结束，轮询下一轮
```

---

## 接力（Relay）流程

当 executor 判断任务还需要下一步时，执行 relay：

```
Executor Session                      Heartbeat Session（下轮）
───────────────                      ───────────────────────

mteam_relay_task({
  taskId: "xxx",
  agentId: "maker",
  contextStep: "整理报价单",
  contextOutput: { summary: "整理了报价对比", files: ["data/quotes.xlsx"] }
})
  → status=pending                   mteam_get_pending()
  → executor=null                      → status=running
  → lastExecutor="maker"              → executor=agent2
  → description="下一步描述"
  session 结束

                                        [executor 2 开始执行]
                                        mteam_update_task(...)
```

relay 时：
- `status` 变为 `pending`，供下一个 agent 认领
- `executor` 设为 `null`
- `lastExecutor` 记录上一个 agent（传承上下文）
- `description` 更新为下一步要做什么
- `context` 追加当前步骤的输出

---

## 心跳保活

Heartbeat Session 每轮检查：

1. **自己有 running 任务？** → 更新 `lastHeartbeatAt`，跳过认领
2. **没有 running 任务？** → 查询 pending 任务并认领

超过 20 分钟 `lastHeartbeatAt` 未更新的任务视为疑似卡住，超过 40 分钟视为死任务，由下一轮 heartbeat 的 sessions_list 检查后自动 relinquish 或忽略。
