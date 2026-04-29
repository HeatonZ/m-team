# M-Team 架构文档

> 版本：2.0 | 更新：2026-04-29
> 变更：pool/ 子目录拆分，SQLite 替换文件锁，subagent_ended hook 自动完成，工具从 7 增至 9

---

## 1. 设计目标

多 agent 在没有中心协调者的情况下，通过共享任务池自主协作。

核心思路：
- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — SQLite 持久化，任务池透明共享
- **接力执行** — executor 只做当前步骤，没完成就放回池子让下一个接上
- **context 追溯** — 完整步骤历史，下一个 executor 能看到之前做了什么
- **自动完成** — Executor Session 结束时 hook 自动标记完成/失败，无需手动调工具

---

## 2. 架构图

```
┌─────────┐
│ Publisher │  发布任务
└────┬────┘
     │ mteam_publish_task
     ▼
┌─────────────────────────────────────┐
│         SQLite 任务池                │  共享持久化
│  ┌─ tasks 表（唯一真实数据源）─┐    │
│  │ taskId / status / context  │    │
│  └─────────────────────────────┘    │
└────┬───────────────────────────────┘
     │ mteam_claim_task
     ▼
┌──────────────────────────────────────────────────────────┐
│  mteam_claim_task                                      │
│    ├─ claimTask()（SQLite 事务，原子操作）              │
│    └─ api.runtime.subagent.run() ──→ Executor Session   │
│         sessionKey: mteam:{taskId}:{agentId}:{ts}      │
└──────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  Executor Session（独立运行）                            │
│                                                          │
│  mteam_update_task({ lastHeartbeatAt })  ← 心跳保活     │
│  mteam_update_task({ status, contextStep, contextOutput })│
│       ├─ pending  → 放回池子，下一个 executor 接上      │
│       └─ completed → 任务结束                           │
│                                                          │
│  subagent_ended hook                                     │
│    outcome=ok/reset → completeTask()                     │
│    其他 outcome  → failTask()                           │
└──────────────────────────────────────────────────────────┘
       ↑
       │relay
       │
┌──────┴──────┐
│  Agent B/C/D │  自主认领 pending 任务
└─────────────┘
```

---

## 3. 通用设计原则

- **publisher 发布任务** — publisher 只是记录身份，不做权限控制
- **执行者自主认领** — 根据 `goal` + `context` 自行判断是否接单
- **agent 不能同时做多个任务** — 有进行中任务时不能认领新任务
- **心跳保活** — 执行中的任务定期更新 `lastHeartbeatAt`
- **context 无限追溯** — 每步 output 追加到 context 数组，供后续 executor 参考
- **task.json 同步写入** — 每个任务目录下保留 task.json，供外部 agent 直接读文件系统

---

## 4. 任务格式

```json
{
  "taskId": "task_1745620000000_abc123",
  "description": "联系供应商确认价格",
  "goal": "找到收纳箱类目下评分高的1688供应商",
  "context": [
    { "type": "input", "data": { "keyword": "收纳箱", "count": 10 }, "createdAt": 1745620000000 },
    { "executor": "agent_1", "step": "搜索1688供应商", "output": { "summary": "找到10家供应商", "files": ["data/suppliers_001.json"] }, "completedAt": 1745621000000 },
    { "executor": "agent_2", "step": "联系供应商确认价格", "output": { "summary": "联系了5家，3家回复" }, "completedAt": 1745622000000 }
  ],
  "priority": "high",
  "publisher": "user",
  "status": "pending",
  "executor": null,
  "lastExecutor": "agent_2",
  "createdAt": 1745620000000,
  "completedAt": null,
  "lastHeartbeatAt": null
}
```

### context 格式说明

| 字段 | 说明 |
|------|------|
| `context[0].type` | 固定为 `"input"`，创建后不可更改 |
| `context[0].data` | 原始输入，任意结构 |
| `context[].executor` | 执行该步骤的 agentId |
| `context[].step` | 步骤描述 |
| `context[].output.summary` | 步骤摘要，建议简洁 |
| `context[].output.files` | 任务文件夹内的相对路径，原始数据放文件里 |
| `context[].completedAt` | 步骤完成时间戳 |

### 优先级

| 值 | 说明 |
|----|------|
| `high` | 🔴 高优先级，优先处理 |
| `normal` | 🟡 中优先级，默认 |
| `low` | 🟢 低优先级 |

### 状态流转

```
pending → running → completed
                        ↘ failed
                        ↘ pending（需接力，taskId 不变）
```

---

## 5. 目录结构

```
workspaceRoot/                   ← 可配置（openclaw.json 中设置）
├── tasks/
│   └── {taskId}/
│       ├── task.json            ← 任务详情（同步写入）
│       └── {产出文件}          ← executor 写入的任务文件夹
└── queue/
    └── m-team.db               ← SQLite 数据库（唯一真实数据源）
```

**数据源优先级**：SQLite tasks 表 > task.json 文件。task.json 是为了让外部工具（如 cat、grep）能直接读取引用，不做为主数据源。

---

## 6. Tool API（9 个）

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务（SQLite 事务，原子操作） |
| `mteam_update_task` | 执行者 | 更新状态/追加 context 步骤 |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | 执行者 | Executor 主动放弃（放回 pending） |
| `mteam_get_pending` | 执行者 | 获取待认领任务（agent 有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_get_all_tasks` | 执行者 | 获取所有任务 |

### 6.1 发布任务

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
  goal: "找到收纳箱类目下评分高的1688供应商",
  input: { keyword: "收纳箱", count: 10 },
  publisher: "user",
  priority: "high"
})
// 返回: { taskId: "task_1745740800000_abc123" }
```

### 6.2 认领任务

```javascript
mteam_claim_task({
  taskId: "task_1745740800000_abc123",
  agentId: "my-agent-id"
})
// 返回: { success: true, taskId: "...", runId: "...", sessionKey: "mteam:{taskId}:{agentId}:{ts}" }
// SQLite 事务：UPDATE tasks SET status='running' WHERE task_id=? AND status='pending'
// Plugin 内部通过 api.runtime.subagent.run() 直接创建 executor session
```

### 6.3 更新状态 / 追加步骤

```javascript
// 完成任务
mteam_update_task({
  taskId: "task_1745740800000_abc123",
  status: "completed",
  contextStep: "联系供应商确认价格",
  contextOutput: { summary: "联系了5家，3家回复", files: ["data/contact_log.md"] }
})

// 接力：需要下一步，放回池子
mteam_update_task({
  taskId: "task_xxx",
  status: "pending",
  contextStep: "整理报价单",
  contextOutput: { summary: "整理了报价对比", files: ["data/quotes.xlsx"] },
  description: "向客户发送最终报价"
})

// 只更新心跳
mteam_update_task({
  taskId: "task_xxx",
  lastHeartbeatAt: Date.now()
})
```

### 6.4 取消任务

```javascript
mteam_cancel_task({
  taskId: "task_xxx",
  publisher: "user",
  reason: "需求变更"
})
// Publisher 才能取消，取消后任务进入 cancelled 状态，不可 relay
```

### 6.5 放弃任务（relay）

```javascript
mteam_relinquish_task({
  taskId: "task_xxx",
  executorId: "agent_1"
})
// 只能是当前 executor 主动调用，调用后 status → pending，清空 executor
```

### 6.6 并发竞态保护

`claimTask` 使用 SQLite 事务：

```sql
BEGIN IMMEDIATE;  -- 获取写锁
SELECT * FROM tasks WHERE task_id=? AND status='pending';
-- 若有结果：UPDATE tasks SET status='running', executor=?, ...;
COMMIT;
```

---

## 7. 心跳检查流程

每个 agent 在心跳时自动检查任务池：

```
1. mteam_get_agent_active({ agentId })
2. 有 running 任务？
     └── 有 → mteam_update_task({ lastHeartbeatAt }) 更新心跳，跳过
3. 无 running 任务 → mteam_get_pending({ agentId })
     └── 有待认领 → mteam_claim_task（直接进入 running）
```

**约束：agent 不能同时做多个任务**

---

## 8. subagent_ended Hook

Executor Session 结束时，Plugin 自动处理：

```javascript
// outcome=ok | reset → 标记完成
completeTask(taskId)

// 其他 outcome → 标记失败，记录 reason
failTask(taskId, errorMsg)
```

**无需 executor 手动调 `mteam_update_task({ status: 'completed' })`**，hook 兜底。

---

## 9. 源码结构

```
src/
├── index.js               # 插件入口（register + 重新导出）
│
├── pool/
│   ├── db.js              # SQLite 连接 + 初始化 + 序列化 helpers
│   ├── index.js           # 对外只读 API（查询 + 通知格式化）
│   └── operations.js      # 所有写操作（publish/claim/update/cancel/relinquish/complete/fail）
│
├── schema/
│   └── task.js            # Task 模型 + 验证 + 格式化（纯函数）
│
├── tools/
│   ├── index.js           # 全部 9 个工具注册（Typebox 参数定义）
│   └── helpers.js         # 参数读取 / jsonResult 封装
│
└── hooks/
    └── subagentEnded.js   # subagent_ended hook 处理器
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `pool/db.js` | SQLite 连接、tasks 表 CRUD、序列化（task ↔ row） |
| `pool/operations.js` | 写操作（publish/claim/update/cancel/relinquish/complete/fail）|
| `pool/index.js` | 只读查询（getPending/getTask/getAllTasks/formatNotifications）|
| `schema/task.js` | Task 模型、createTask、validateTask、格式化输出 |
| `tools/index.js` | 9 个工具的 Typebox schema + execute 实现 |
| `tools/helpers.js` | readStr/readNum/jsonResult 等工具函数 |
| `hooks/subagentEnded.js` | session 结束时自动 complete/fail 任务 |

---

## 10. 技术细节

### 10.1 构建

```bash
npm run build    # esbuild bundle 到 dist/index.js
```

esbuild 配置：
- `platform=node` + `format=esm`
- `external: node:* / openclaw / openclaw/plugin-sdk`
- bundle 大小约 122KB（含 @sinclair/typebox runtime）

### 10.2 测试

```bash
npm run test     # watch 模式
npm run test:run # 单次运行
```

当前测试覆盖：`src/schema/task.js` 纯函数（createTask / validateTask / format*）。

### 10.3 安装路径

- **WSL 开发路径**：`/mnt/d/code/m-team/`（权限干净）
- **OpenClaw 安装路径**：`~/.openclaw/extensions/m-team/`（由 `openclaw plugins install` 管理）
- **工作目录**：`/home/hjl/.openclaw/m-team/`（tasks/ 和 queue/ 在此）

**重要：开发代码在 `/mnt/d/code/m-team`，不要直接改 `~/.openclaw/extensions/m-team/`**

---

## 11. 配置文件

`openclaw.json` 中的插件配置：

```json
{
  "plugins": {
    "entries": {
      "m-team": {
        "enabled": true,
        "config": {
          "workspace": {
            "root": "/home/hjl/.openclaw/m-team"
          },
          "notifications": [
            {
              "provider": "feishu",
              "groupId": "oc_xxxxx",
              "agents": ["agent_1"]
            },
            {
              "provider": "discord",
              "channelId": "123456",
              "agents": ["agent_1", "agent_2"]
            }
          ]
        }
      }
    }
  }
}
```

---

## 12. 双 Session 模型

M-Team 使用两个独立的 OpenClaw Session，它们之间没有任何消息传递机制：

### 两个 Session

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、维护心跳、认领任务 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部通过 `api.runtime.subagent.run()` 创建 | 实际执行任务 | 任务级 |

### 关键约束

- **Plugin 内部创建**：`mteam_claim_task` 在 claim 成功后直接调用 `api.runtime.subagent.run()`，无需 executor agent 单独操作
- **sessionKey 格式**：`mteam:{taskId}:{agentId}:{timestamp}`，心跳 session 通过解析第一段提取 taskId
- **完全独立**：Executor session 完成后不通知 Heartbeat session；Heartbeat 靠 `lastHeartbeatAt` + 轮询 `mteam_get_agent_active` 判断状态
- **无跨 Session 回调**：Executor Session 结束时靠 `subagent_ended` hook 标记完成，不依赖 Heartbeat 轮询

### 时序

```
Heartbeat Session                Executor Session
─────────────────              ─────────────────
mteam_claim_task()
  ├─ claimTask()（SQLite 事务）
  └─ api.runtime.subagent.run()
       sessionKey="mteam:task123:{agentId}:{ts}"
       message="[M-Team Task...]"     ← 启动 executor agent
  return { success, taskId, runId, sessionKey }

mteam_update_task({ lastHeartbeatAt })
sleep(10min)                      [executor 跑任务]

sleep(10min)                      [executor 完成，session 空闲]
subagent_ended hook
  → completeTask(taskId)

mteam_get_agent_active()
  → status=completed → 任务已结束，轮询下一轮
```

---

## 13. 关键原则

1. **schema 固定，路径可配置** — `schema/task.js` 只定义任务格式，`workspace.root` 是唯一配置项
2. **去中心化 = 没有单点** — 任务池是共享的，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不要让任务卡在 running
6. **context 无限追溯** — 每步 output 追加到 context，不丢历史
7. **hook 兜底** — Executor Session 结束时自动完成任务，不依赖手动调用

---

## 14. 已知限制

- ~~并发竞态~~ — ✅ 已用 SQLite 事务解决
- ~~手动标记完成~~ — ✅ `subagent_ended` hook 自动处理
- ~~文件锁复杂度~~ — ✅ SQLite 事务替代
- 任务积压：心跳间隔内任务可能被多个 agent 同时看到，需尽快 claim
