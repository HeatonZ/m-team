# M-Team — 源码结构与技术细节

> 版本：4.0 | 更新：2026-05-09
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[TASK.md](./TASK.md)

---

## 源码结构

```text
src/
├── index.ts
├── pool/
│   ├── db.js
│   ├── index.js
│   └── operations.js
├── schema/
│   └── task.ts
├── tools/
│   ├── index.ts
│   └── helpers.js
├── hooks/
│   ├── agentEnd.ts
│   ├── afterToolCall.ts
│   ├── heartbeatPromptContribution.ts
│   └── sessionGuard.ts
└── notifications.ts
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `pool/db.js` | SQLite 连接、tasks 表初始化、CRUD helpers、task ↔ row 序列化 |
| `pool/operations.js` | 所有写操作（publish / claim / relinquish / reject / cancel / close / complete / relay / fail / retain） |
| `pool/index.js` | 只读查询（getPending / getTask / getAllTasks） |
| `schema/task.ts` | Task 模型定义、taskType / status / priority / lifecycle、createTask、validateTask、格式化输出 |
| `tools/index.ts` | 工具注册与参数定义 |
| `hooks/agentEnd.ts` | 链式状态机收口：complete / relay / fail / retain 自动判断 |
| `hooks/afterToolCall.ts` | publish / claim / relinquish / reject / cancel / close 日志+通知 |
| `hooks/heartbeatPromptContribution.ts` | heartbeat prompt 注入 |
| `hooks/sessionGuard.ts` | 心跳 / executor session 工具调用约束 |
| `notifications.ts` | 通知格式化函数 |

---

## 运行时数据流

```text
src/index.ts (register)
  ├─ registerTools(api, config)
  │    └─ tools/index.ts → pool/operations.js → pool/db.js
  ├─ registerAgentEndHook(api)
  │    └─ hooks/agentEnd.ts
  │         ├─ success=false → failTask
  │         ├─ 已达成 goal → completeTask
  │         ├─ 需要下一棒 → relayTask(handoff / reworking)
  │         └─ 当前 executor 继续做 → retainTaskOwnership(executing / finalizing)
  ├─ registerAfterToolCallHook(api)
  │    └─ publish/claim/relinquish/reject/cancel/close 写日志+通知
  └─ registerHeartbeatPromptContributionHook(api)
       └─ 注入 heartbeat prompt
```

---

## 数据库 Schema

tasks 表：

```sql
CREATE TABLE tasks (
  task_id        TEXT PRIMARY KEY,
  task_type      TEXT NOT NULL DEFAULT 'general',
  description    TEXT NOT NULL,
  goal           TEXT NOT NULL,
  context        TEXT NOT NULL DEFAULT '[]',
  lifecycle      TEXT,
  flow           TEXT,
  priority       TEXT NOT NULL DEFAULT 'normal',
  publisher      TEXT NOT NULL DEFAULT 'user',
  status         TEXT NOT NULL DEFAULT 'pending',
  executor       TEXT,
  last_executor  TEXT,
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  updated_at     INTEGER NOT NULL
);
```

### 存储约定
- `context` 存 JSON 字符串
- `lifecycle` 存链式状态机内部状态
- `flow` 仅保留给旧数据兼容迁移
- 老库无 `lifecycle` 时，启动迁移补列，并从旧 `flow` 映射到新 `lifecycle`
- 所有时间存毫秒时间戳

---

## 状态机实现重点

### 主状态
- `status`：`pending / running / completed / closed / failed / cancelled`
- `lifecycle.phase`：`ready / executing / handoff / reworking / finalizing / done`

### 主路径
```text
pending + ready/handoff/reworking
  → claim
  → running + executing
  → handoff / reworking / finalizing / done / failed
```

### loopGuard
`lifecycle.loopGuard` 记录：
- `samePhaseCount`
- `sameDescriptionCount`
- `noProgressCount`
- `lastDescriptionFingerprint`
- `lastContextFingerprint`
- `lastProgressAt`

用途：避免 description 不变、phase 不变、无有效进展时无限循环。

---

## 构建

```bash
npm run build:plugin
```

当前这轮主要用 `build:plugin` 验证 bundle 是否可构建。

---

## 测试

```bash
npm run test
npm run test:run
```

当前最需要补的是：
- lifecycle / phase 流转测试
- relay(handoff/reworking) 判定测试
- loopGuard 熔断测试
- heartbeat 认领语义测试

---

## 配置文件

插件配置核心仍是：
- `workspace.root`
- `notifications`
- `hooks.allowConversationAccess`

`allowConversationAccess` 对 `agent_end` 必需，因为它要读取执行轮 messages 进行状态机收口。

---

## 安装路径

- **WSL 开发路径**：`/mnt/d/code/m-team/`
- **OpenClaw 安装路径**：`~/.openclaw/extensions/m-team/`
- **工作目录**：`/home/hjl/.openclaw/m-team/`

**重要**：开发改动只在 `/mnt/d/code/m-team` 做，不直接改安装目录。
