# M-Team — 双 Session 模型

> 版本：3.1 | 更新：2026-05-08
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

**executor 不调用任何管理工具**。只管执行 description 规定的步骤，然后结束 session。后续的 complete/relay/fail 由 `agent_end` hook 自动判断。

**执行流程**：
1. 先调用 `mteam_get_task` 查任务详情（含执行历史 + 当前 description）
2. 根据执行历史确认当前步骤是否已在历史中完成
3. 根据 description 执行当前步骤
4. 做完后直接结束 session

---

## agent_end Hook

Executor Session 结束时，`agent_end` hook 自动触发，根据 session 结束方式做不同处理：

```typescript
api.on('agent_end', async (event) => {
  // event: { success, messages, taskId, agentId, sessionKey, error }

  // 1. 解析 sessionKey，提取 taskId
  if (!sessionKey?.startsWith('agent:') || !sessionKey?.includes(':m-team:')) return;
  const taskId = sessionKey.split(':')[3];

  // 2. 异常结束（success=false）→ 直接 fail
  if (!success) {
    const errorMsg = error ?? 'unknown_error';
    failTask(taskId, errorMsg, undefined, { outcome: 'error', error: errorMsg });
    writeTaskLog({ taskId, action: 'fail', sessionKey, agentId, error: errorMsg });
    sendNotifications(formatFailNotifications(task, errorMsg));
    return;
  }

  // 3. 正常结束 → LLM 读对话记录判断 complete 还是 relay
  const decision = await judgeByLlm(messages, task);

  if (decision === 'relay') {
    relayTask(taskId, executorId, { step: '[agent_end] executor 正常结束，hook 判断需要 relay' });
    writeTaskLog({ taskId, action: 'relay', sessionKey, agentId });
    sendNotifications(formatRelayNotifications(result.task));
  } else {
    completeTask(taskId, { step: '[agent_end] executor 正常结束，hook 判断任务完成' });
    writeTaskLog({ taskId, action: 'complete', sessionKey, agentId });
    sendNotifications(formatTaskNotifications(result.task));
  }
});
```

**四种结果**：

| 条件 | 动作 | 写日志 | 发通知 |
|------|------|--------|--------|
| `success=false`（异常退出） | `failTask` | ✅ | `formatFailNotifications` |
| LLM 判断 relay | `relayTask` | ✅ | `formatRelayNotifications` |
| LLM 判断 complete | `completeTask` | ✅ | `formatTaskNotifications` |

**关键设计**：
- executor 不调用 complete/relay/fail，只管执行然后结束
- `agent_end` 读取 `event.messages`（完整对话历史）判断下一步
- 写日志 + 发通知都在 hook 内完成，不走工具层

**Relay 时下一步描述格式要求**：

`agent_end` hook 判断需要 relay 时，LLM 生成的下一步描述必须包含 4 个要素：

| 要素 | 说明 | 示例 |
|------|------|------|
| 动作 | 动词开头 | 继续搜索、筛选、抓取、生成 |
| 目标 | 要操作的对象 | 宠物玩具、商品详情页、图片 |
| 条件 | 明确的过滤维度 | costPrice ≤ 5 RMB、规格数 ≤ 8 |
| 数量逻辑 | **"找够 N 个"**，禁止"前 N 个" | 找够剩余 3 个 |

坏味道（出现即预警）：
- "继续搜索更多" → 没说要找多少个 ❌
- "做下一步" → 没写具体动作 ❌
- "数量不够继续找" → 没说要找多少个 ❌

好味道：
- "继续搜索宠物玩具，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8，**找够剩余 3 个**" ✅
- "抓取商品详情页，提取标题、价格、规格数" ✅

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

Tn                                             [executor 执行 description 步骤]
                                             [executor 结束 session]

                                             agent_end hook
                                               → LLM 判断 complete / relay / fail
                                             session 关闭

Tn+1              mteam_get_agent_active()      [session 已关闭]
                    → status=completed 或 pending
                    → 本轮结束，轮询下一轮
```

---

## 接力（Relay）流程

当 executor 执行完后，agent_end hook 判断需要 relay 时执行：

```
Agent B 执行 description 步骤
  → description 步骤已做，但仍需继续
  → executor 结束 session

agent_end hook
  → relayTask(taskId, executorId, { step: '...', description: '下一步描述' })
  → status=pending
  → executor=null
  → lastExecutor="maker"
  → description="下一棒要执行的具体步骤描述"
  session 结束

下一轮 Heartbeat：
  mteam_get_pending()
    → 新 executor 认领
    → 继续执行
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

`updatedAt` 由任务操作（claim/relay/complete/fail/cancel）自动更新。超过 40 分钟 `updatedAt` 未更新的 running 任务视为死任务，由 heartbeat sessions_list 检查后自动 relinquish。
