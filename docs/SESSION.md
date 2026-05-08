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

**executor 不调用任何管理工具**。只管执行 description 规定的步骤，然后结束 session。后续的 complete/relay/fail 由 `session_end` hook 自动判断。

**执行流程**：
1. 先调用 `mteam_get_task` 查任务详情（含执行历史 + 当前 description）
2. 根据执行历史确认当前步骤是否已在历史中完成
3. 根据 description 执行当前步骤
4. 做完后直接结束 session

---

## session_end Hook

Executor Session 真正结束时，`session_end` hook 自动触发，只处理 task executor session，并按 session 终止类型收口：

```typescript
api.on('session_end', async (event, ctx) => {
  const { sessionKey, agentId, sessionId } = ctx;
  const taskId = parseTaskId(sessionKey);
  if (!taskId) return;
  if (!isExecutorSessionForTask(sessionKey, agentId, taskId)) return;

  // 非终态结束（压缩、idle、reset 等）一律跳过，避免误判
  if (NON_TERMINAL_SESSION_END_REASONS.has(event.reason)) return;

  // 同一 session 已有 complete / relay / fail 日志时，跳过重复收口
  if (hasTerminalLogForSession(taskId, sessionKey, workspaceRoot)) return;

  const transcriptMessages = readSessionTranscript(event.sessionFile);
  if (transcriptMessages.length === 0) {
    failTask(taskId, 'SESSION_TRANSCRIPT_EMPTY');
    writeTaskLog({ taskId, action: 'fail', sessionKey, agentId });
    return;
  }

  const decision = await judgeByLlm(transcriptMessages, task);

  if (decision.decision === 'relay') {
    // 若 nextDescription 与当前 description 完全相同，禁止原样 relay，直接 fail
    relayTask(taskId, executorId, { step: decision.contextStep, output: decision.contextOutput }, relayDescription);
    writeTaskLog({ taskId, action: 'relay', sessionKey, agentId });
  } else {
    completeTask(taskId, { step: decision.contextStep, output: decision.contextOutput });
    writeTaskLog({ taskId, action: 'complete', sessionKey, agentId });
  }
});
```

**四种结果**：

| 条件 | 动作 | 写日志 | 发通知 |
|------|------|--------|--------|
| `event.reason in {compaction,idle,daily,deleted,reset,unknown}` | 跳过 | ❌ | ❌ |
| transcript 为空 | `failTask` | ✅ | `formatFailNotifications` |
| LLM 判断 relay | `relayTask` | ✅ | `formatRelayNotifications` |
| LLM 判断 complete | `completeTask` | ✅ | `formatTaskNotifications` |

**关键设计**：
- executor 不调用 complete/relay/fail，只管执行然后结束
- `session_end` 读取 `event.sessionFile` 重建完整 transcript，不依赖 `agent_end.messages`
- 只处理 `agent:{agentId}:m-team:{taskId}` 这种 executor task session
- 同一 session 已经出现 terminal task_log 时直接跳过，避免双重 complete / relay / fail
- 非终态结束原因直接跳过，避免 compaction / reset 误触发收口

**Relay 时下一步描述格式要求**：

`session_end` hook 判断需要 relay 时，LLM 生成的下一步描述必须包含 4 个要素：

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

T1                                                  执行 description 规定的步骤
T2                                                  完成后直接结束 session
T3                （无需参与）                      session_end hook 触发
                                                     ├─ reason=compaction/idle/reset/... → skip
                                                     ├─ transcript 为空 → failTask()
                                                     ├─ LLM 判断 RELAY → relayTask()
                                                     └─ LLM 判断 COMPLETE → completeTask()

T4                下次 heartbeat 看池子状态
                    ├─ 如果被 relay → 重新认领继续做
                    └─ 如果已 complete → publisher 验收 close/reject
```

---

## 接力（Relay）流程

当 executor 执行完后，`session_end` hook 判断需要 relay 时执行：

```
Agent B 执行 description 步骤
  → description 步骤已做，但仍需继续
  → executor 结束 session

`session_end` hook
  → relayTask(taskId, executorId, { step: '...', output: {...} }, relayDescription)
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

Publisher 心跳每轮检查自己发布的 running 任务：

1. 调用 `mteam_get_all_tasks({ status: 'running' })` 获取所有运行中任务
2. 过滤出 publisher = 自己 的任务
3. 判断超时：任务的 **updatedAt** 距今超过 1 小时 → 判定为死任务
4. 处理超时：调用 `mteam_relinquish_task({ taskId, reason: '超时放回任务池' })`
5. 每次心跳最多处理 1 个超时任务，处理完立即结束

**注意**：是 `updatedAt`（最后更新时间），不是 `createdAt`（创建时间）。`updatedAt` 在每次 claim/relay/complete/fail 时自动更新。
