# M-Team 架构文档

> 版本：3.1 | 更新：2026-05-08

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
- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — SQLite 持久化，任务池透明共享
- **接力执行** — executor 只做当前步骤，没完成就放回池子让下一个接上
- **context 追溯** — 完整步骤历史，下一个 executor 能看到之前做了什么
- **hook 统一终态** — executor 不调用 complete/relay/fail，全部由 `agent_end` hook 在 session 结束时自动判断

---

## 架构图

```
┌─────────┐
│ Publisher │  发布任务
└────┬────┘
     │ mteam_publish_task
     ▼
┌─────────────────────────────────────┐
│         SQLite 任务池                │  共享持久化
│  tasks 表（唯一真实数据源）          │
└────┬───────────────────────────────┘
     │ mteam_claim_task
     ▼
┌──────────────────────────────────────────────────────────┐
│  mteam_claim_task                                       │
│    ├─ claimTask()（SQLite 事务，原子操作）              │
│    └─ api.runtime.subagent.run() ──→ Executor Session    │
│         sessionKey: agent:{agentId}:m-team:{taskId}  │
└──────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  Executor Session（只管执行，然后结束）                   │
│                                                          │
│  agent_end hook（session 结束时自动触发）                │
│    ├─ 异常退出（success=false）→ failTask               │
│    ├─ LLM 判断需 relay → relayTask                      │
│    └─ LLM 判断完成 → completeTask                        │
│                                                          │
│  日志 + 通知：afterToolCall（工具调用）/ agent_end（终态）│
│                                                          │
│  Publisher 心跳（PUBLISHER_ACCEPTANCE_PROMPT）           │
│  mteam_close_task({ taskId, publisher })  ← 验收通过    │
│  mteam_reject_task({ taskId, reason })     ← 驳回重做   │
└──────────────────────────────────────────────────────────┘
       ↑
       │relay（放回 pending）
       │
┌──────┴──────┐
│  Agent B/C/D │  自主认领 pending 任务
└─────────────┘
```

**两种日志+通知来源**：

| 来源 | 覆盖事件 |
|------|---------|
| `afterToolCall` hook | publish / claim / relinquish / reject / cancel / close |
| `agent_end` hook | fail / relay / complete |

---

## 通用设计原则
- **publisher 发布任务** — publisher 只是记录身份，不做权限控制
- **执行者自主认领** — 根据 `description` + `context` 自行判断是否接单（`goal` 仅用于复盘，认领时不暴露）
- **agent 不能同时做多个任务** — 有进行中任务时不能认领新任务
- **任务卡死检测** — running 任务超过 1 小时 `updatedAt` 未更新视为死任务，Publisher 心跳时自动 relinquish 放回任务池
- **context 无限追溯** — 每步 output 追加到 context 数组，供后续 executor 参考
- **task.json 同步写入** — 每个任务目录下保留 task.json，供外部工具直接读文件系统
- **hook 统一终态** — executor 不调用 complete/relay/fail，agent_end hook 读完整对话记录自动判断

---

## 关键原则
1. **schema 固定，路径可配置** — `schema/task.js` 只定义任务格式，`workspaceRoot` 是唯一配置项
2. **去中心化 = 没有单点** — 任务池是共享的，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不要让任务卡在 running
6. **context 无限追溯** — 每步 output 追加到 context，不丢历史
7. **hook 统一终态** — executor 只管执行，agent_end hook 读对话记录判断 complete/relay/fail
