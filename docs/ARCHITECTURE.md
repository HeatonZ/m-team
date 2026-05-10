# M-Team 架构文档

> 版本：4.0 | 更新：2026-05-09

本文档分为 4 篇：

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 设计目标、架构图、设计原则 |
| [TASK.md](./TASK.md) | 任务格式、Tool API、状态流转 |
| [SESSION.md](./SESSION.md) | 双 Session 模型、心跳流程、agent_end hook |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | 源码结构、技术细节、配置、安装路径 |

---

## 设计目标

多 agent 在没有中心协调者的情况下，通过共享任务池自主协作。

核心思路：
- **去中心化** — 没有单点协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — SQLite 持久化，任务池透明共享
- **链式接力** — executor 只做当前一棒，做完后把结果交给下一棒或进入收口
- **context 追溯** — 完整步骤历史，下一棒能基于前序上下文继续
- **状态机收口** — executor 不调用 complete/relay/fail，全部由 `agent_end` hook 在执行轮结束时自动判断

---

## 架构图

```text
┌───────────┐
│ Publisher │ 发布任务
└─────┬─────┘
      │ mteam_publish_task
      ▼
┌─────────────────────────────────────┐
│          SQLite 任务池              │
│  tasks 表（唯一真实数据源）         │
└─────┬───────────────────────────────┘
      │ mteam_claim_task
      ▼
┌──────────────────────────────────────────────────────────────┐
│ mteam_claim_task                                             │
│   ├─ claimTask()（SQLite 事务，原子操作）                    │
│   └─ api.runtime.subagent.run() ──→ Executor Session         │
│        sessionKey: agent:{agentId}:m-team:{taskId}           │
└──────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────┐
│ Executor Session（只管执行当前一棒，然后结束）               │
│                                                              │
│ agent_end hook（执行轮结束时自动触发）                       │
│   ├─ success=false → failTask                                │
│   ├─ 已达成 goal → completeTask                              │
│   ├─ 需要下一棒 → relayTask(handoff / reworking)             │
│   └─ 当前 executor 继续收口/续做 → retainTaskOwnership       │
│                                                              │
│ 日志 + 通知：afterToolCall（工具调用）/ agent_end（终态）     │
│                                                              │
│ Publisher 心跳（PUBLISHER_ACCEPTANCE_PROMPT）                │
│ mteam_close_task({ taskId, publisher })  ← 验收通过          │
│ mteam_reject_task({ taskId, reason })     ← 驳回重做         │
└──────────────────────────────────────────────────────────────┘
      ▲
      │ relay（放回 pending）
      │
┌─────┴─────┐
│ Agent B/C │ 自主认领 pending 任务
└───────────┘
```

**两种日志+通知来源**：

| 来源 | 覆盖事件 |
|------|---------|
| `afterToolCall` hook | publish / claim / relinquish / reject / cancel / close |
| `agent_end` hook | fail / relay / complete / retain |

---

## 通用设计原则
- **publisher 发布任务** — publisher 只是记录身份，不做复杂权限中心
- **执行者自主认领** — 根据 `taskType` 粗筛，再结合 `description` + `context` 自行判断是否接单
- **agent 不能同时做多个任务** — 有进行中任务时不能认领新任务
- **任务卡死检测** — running 任务超过 1 小时 `updatedAt` 未更新视为死任务，Publisher 心跳时自动 relinquish 放回任务池
- **context 无限追溯** — 每步 output 追加到 context 数组，供后续 executor 参考
- **task.json 同步写入** — 每个任务目录下保留 task.json，供外部工具直接读文件系统
- **hook 统一终态** — executor 不调用 complete/relay/fail，agent_end hook 读执行轮对话并自动判断终态

---

## 关键原则
1. **schema 固定，路径可配置** — `schema/task.js` 定义任务格式，`workspaceRoot` 是主要配置项
2. **去中心化** — 任务池共享，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不让任务长期卡在 `running + executing/finalizing`
6. **context 作为交接载体** — 每步 output 追加到 context，不丢历史
7. **taskType 先粗筛** — heartbeat 先按类型判断，再按 description 细判
8. **description 只描述当前一棒** — 不让 description 漂成整条任务链目标
9. **hook 统一终态** — executor 只管执行，agent_end 根据状态机判断 complete / relay / fail / retain

## retain 语义

- **主路径**：`executing → handoff/reworking → executing → finalizing → done`
- **普通 relay**：当前这一步做完，但控制权应交回任务池 → `status=pending`、`executor=null`
- **retain**：当前 executor 仍应继续持有任务，不应退池。典型场景：
  - 当前一棒尚未真正结束，但已有明确中间进展
  - 当前 executor 正在 `finalizing` 做最后收口
- retain 不是新的对外 status，而是 `running` 状态下的内部 lifecycle 语义

一句话：**链式任务的主路径是 handoff，不是 retain。**
