# M-Team — 双 Session 模型

> 版本：4.0 | 更新：2026-05-09
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[TASK.md](./TASK.md)

---

## 两个 Session

M-Team 使用两个独立的 OpenClaw Session，它们之间没有消息传递机制：

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、认领任务、Publisher 验收 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部通过 `api.runtime.subagent.run()` 创建 | 执行当前一棒 | 任务级 |

---

## Session 职责

### Heartbeat Session

由 `heartbeat_prompt_contribution` hook 驱动。

**Executor 心跳**（空闲时）：
```text
mteam_get_pending({ agentId })
  → 先看 taskType（类型粗筛）
  → 再看 description（当前一棒动作）
  → 结合已有 context，判断是否能基于前序结果继续
  → 适合自己 → mteam_claim_task
  → 不适合 → HEARTBEAT_OK
```

**注意**：认领时主要看 `taskType + description + context`，`goal` 仅用于复盘，不参与认领决策。

**Publisher 心跳**：
```text
mteam_get_all_tasks()
  → 过滤 COMPLETED + publisher=self
  → 通过 → mteam_close_task
  → 驳回 → mteam_reject_task({ taskId, reason })
```

### Executor Session

由 `mteam_claim_task` 在 claim 成功后内部创建，sessionKey 格式为：

```text
agent:{agentId}:m-team:{taskId}
```

**executor 不调用任何管理工具**。只执行 `description` 规定的当前一棒，然后结束 session。后续 `complete / relay / fail / retain` 由 `agent_end` hook 自动判断。

**执行流程**：
1. 调用 `mteam_get_task` 查看 taskType、description、context、lifecycle
2. 确认当前一棒要做什么，以及前序 context 已完成到哪
3. 基于前序 context 执行当前步骤
4. 在最后一条消息里写清结果 / 文件 / 下一棒建议
5. 直接结束 session

---

## agent_end Hook

Executor Session 执行轮结束时，`agent_end` hook 自动触发，只处理 task executor session，并按链式状态机收口：

```typescript
api.on('agent_end', async (event, ctx) => {
  if (!event.success) failTask(taskId, event.error ?? 'AGENT_RUN_FAILED');
  else if (loopGuardTriggered) failTask(taskId, 'LOOP_GUARD_TRIGGERED');
  else if (goalSatisfied) completeTask(taskId, contextEntry);
  else if (needsAnotherStep) relayTask(taskId, executorId, contextEntry, nextDescription, mode);
  else if (currentExecutorShouldContinue) retainTaskOwnership(taskId, executorId, contextEntry, nextDescription, phase);
  else failTask(taskId, 'NO_RECOVERABLE_PROGRESS');
});
```

### 四种结果

| 条件 | 动作 |
|------|------|
| `success=false` | `failTask` |
| 触发 loopGuard / 无有效进展 | `failTask` |
| 已达成 goal | `completeTask` |
| 需要下一棒 | `relayTask(handoff / reworking)` |
| 当前 executor 继续做更合理 | `retainTaskOwnership(executing / finalizing)` |

### 关键设计
- executor 不调用 complete/relay/fail，只管执行然后结束
- `agent_end` 直接读取执行轮消息，不依赖额外 session 文件
- 主路径是 `executing → handoff/reworking → executing → finalizing → done`
- `retain` 是例外路径，不是默认路径
- loopGuard 内建，避免 description/phase 原地打转

### Relay 时 description 要求

下一棒 description 必须包含 4 个要素：

| 要素 | 说明 | 示例 |
|------|------|------|
| 动作 | 动词开头 | 继续搜索、筛选、抓取、生成 |
| 对象 | 要处理的东西 | 商品、文件、结果集 |
| 依据 | 基于哪份前序 context / 文件 | 基于 `result.json` |
| 完成标准 | 这一棒做完的判定 | 补足到 5 个、补齐缺失字段 |

坏例子：
- “继续处理” ❌
- “做下一步” ❌
- “汇总一下结果” ❌

好例子：
- “基于 `result.json` 中已筛出的商品，补写英文 listing 到 `listing.md`，每个商品需包含标题、卖点和规格说明” ✅
- “复核当前候选商品，移除规格数 ≥ 8 的条目，并补足到 5 个合格商品” ✅

---

## 完整时序

```text
T0  Heartbeat Session: mteam_claim_task()
T1  Executor Session: 执行 description 当前一棒
T2  Executor Session: 最后一条消息写结果 / 文件 / 下一棒建议
T3  Executor Session: 结束 session
T4  agent_end hook: 自动判断 complete / relay / retain / fail
T5  下次 Heartbeat: 根据新的 pending/running 状态继续
```

---

## 接力（Relay）流程

当 executor 执行完后，`agent_end` 判断需要下一棒时：

```text
Agent B 执行当前 description
  → 当前棒已完成，但任务未结束
  → executor 结束 session

agent_end hook
  → relayTask(taskId, executorId, { step, output }, nextDescription, mode)
  → status = pending
  → phase = handoff 或 reworking
  → executor = null
  → lastExecutor = 当前 agent
  → context 追加本步结果
  → description 更新为下一棒唯一动作
```

relay 时：
- `handoff` = 正常接力，进入下一步
- `reworking` = 返工接力，修当前问题

---

## retain 流程

retain 只允许两类场景：

1. 当前一棒尚未真正结束，但已有明确中间进展
2. 当前 executor 正在 `finalizing` 做最后收口

表现为：
- `status` 仍为 `running`
- `executor` 保持当前 agent
- `lifecycle.phase` 仍为 `executing` 或 `finalizing`
- heartbeat 不会重新认领该任务

只有当控制权确实该交给下一棒时，才走普通 relay。

---

## 任务卡死检测

Publisher 心跳每轮检查自己发布的 running 任务：
1. 获取所有 `running` 任务
2. 过滤 publisher = 自己
3. 判断 `updatedAt` 距今是否超过 1 小时
4. 超时则调用 `mteam_relinquish_task({ taskId, reason: '超时放回任务池' })`
5. 每次心跳最多处理 1 个超时任务

**注意**：超时口径看 `updatedAt`，不是 `createdAt`。
