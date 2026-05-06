# M-Team — 双 Session 模型

> 版本：2.2 | 更新：2026-05-06
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[TASK.md](./TASK.md)

---

## 两个 Session

M-Team 使用两个独立的 OpenClaw Session，它们之间没有任何消息传递机制：

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、认领任务 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部通过 `api.runtime.subagent.run()` 创建 | 实际执行任务 | 任务级 |

---

## Session 职责

### Heartbeat Session

由 heartbeat_prompt_contribution hook 驱动，每次心跳注入对应角色的 prompt：

**Executor 心跳**（空闲时）：
```
mteam_get_pending({ agentId })
  → 看 description（下一步要做什么），判断是否适合自己
  → 适合 → mteam_claim_task
  → 不适合 → 回复 "HEARTBEAT_OK"
```
**注意**：pending 返回不含 goal，goal 是复盘标尺，认领时不看。

**Publisher 心跳**：
```
mteam_get_all_tasks()
  → 过滤 COMPLETED + publisher=self
  → 通过 → mteam_close_task
  → 驳回 → mteam_reject_task({ taskId, reason: "驳回原因" })
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
api.on('subagent_ended', async (event) => {
  const { targetSessionKey, outcome, error } = event;

  // 只处理 agent:{agentId}:m-team:{taskId} 格式的 session
  if (!targetSessionKey?.startsWith('agent:')) return;
  if (!targetSessionKey?.includes(':m-team:')) return;
  const taskId = targetSessionKey.split(':')[3];

  if (outcome === 'ok' || outcome === 'reset') {
    // executor 已通过 relay_task 或 complete_task 自行处理任务状态
    // subagent_ended 只打 log，不重复操作
    log(`任务 ${taskId} executor 已处理 (outcome=${outcome})`);
  } else {
    // session 非正常结束（崩溃/异常）→ failTask
    failTask(taskId, error || outcome);
  }
});
```

**结果**：

| outcome | 动作 |
|---------|------|
| `ok` / `reset` | 只 log（executor 已自行 complete 或 relay） |
| 其他 | `failTask(taskId)` — 标记失败 |

**关键设计**：
- executor 调用 `mteam_complete_task` 或 `mteam_relay_task` 后，任务状态已在 DB 中更新
- subagent_ended 只负责"session 异常退出"兜底，不干扰正常流程
- relay 后任务已是 PENDING，completeTask 会因状态不是 RUNNING 而幂等跳过

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
  contextOutput: { summary: "整理了报价对比", files: ["data/quotes.xlsx"] },
  description: "发送报价给客户"
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
- `context` 追加当前步骤的输出
- `description` 更新为下一棒要执行的具体步骤描述（**必填**，由当前 executor 填写）

---

## 任务卡死检测

Heartbeat Session 每轮检查：

1. **自己有 running 任务？** → 跳过认领
2. **没有 running 任务？** → 查询 pending 任务并认领

`updatedAt` 由任务操作（claim/relay/complete/fail/cancel）自动更新。超过 20 分钟 `updatedAt` 未更新的 running 任务视为疑似卡住，超过 40 分钟视为死任务，由下一轮 heartbeat 的 sessions_list 检查后自动 relinquish 或忽略。
