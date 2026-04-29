# M-Team 架构文档

> 版本：1.3.0 | 更新：2026-04-29

---

## 1. 设计目标

多 agent 在没有中心协调者的情况下，通过共享任务池自主协作。

核心思路：
- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — 任务池是文件系统中的队列，节点自主读写
- **接力执行** — executor 只做当前步骤，没完成就放回池子让下一个接上
- **context 追溯** — 完整步骤历史，下一个 executor 能看到之前做了什么

---

## 2. 架构图

```
┌─────────┐
│ Publisher │  发布任务
└────┬────┘
     │ mteam_publish_task
     ▼
┌─────────────────────────────────┐
│      任务池 (queue/tasks.json) │  共享文件
└────┬────────────────────────────┘
     │ mteam_claim_task
     ▼
┌──────────────┐    ┌─────────────────────────────────────┐
│ Heartbeat    │    │         Executor Session              │
│ Session      │    │  (Plugin 内部通过 api.runtime.subagent │
│ (HEARTBEAT   │    │   .run() 创建，sessionKey 格式:       │
│  模板驱动)   │    │   mteam:{taskId}:executor)           │
│              │    │                                      │
│ 心跳轮询:    │    │  独立跑任务，不占用心跳 session       │
│ mteam_get_   │    │  完成后写 tasks/{taskId}/task.json   │
│  agent_active│    │  不通知心跳 session                   │
│              │    │                                      │
│ mteam_update │    │                                      │
│ _task        │    │                                      │
│ (lastHeartb..│    │                                      │
└──────┬───────┘    └─────────────────────────────────────┘
       │                     ↑
       │ mteam_claim_task     │
       │ ├─ claimTask()      │
       │ └─ api.runtime.      │
       │     subagent.run() ──┘  (Plugin 内部创建)
       │
       ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Agent B │ │ Agent C │ │ Agent D │  自主认领
└────┬────┘ └────┬────┘ └────┬────┘
     │            │           │
     │ mteam_update_task      │
     │ (context 追加 steps)  │
     │           │           │
     │◄──────────┴────────────┘  接力：放回 pending
```

---

## 3. 通用设计原则

- **管理者发布任务** — `publisher` 只是记录发布者身份，不做权限控制
- **执行者自主认领** — 根据 `goal` + `context` 自行判断是否接单
- **agent 不能同时做多个任务** — 有进行中任务时不能认领新任务
- **心跳保活** — 执行中的任务定期更新 `lastHeartbeatAt`
- **context 无限追溯** — 每步 output 追加到 context 数组，供后续 executor 参考

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

**优先级：**

| 值 | 说明 |
|----|------|
| `high` | 🔴 高优先级，优先处理 |
| `normal` | 🟡 中优先级，默认 |
| `low` | 🟢 低优先级 |

**状态流转：**

```
pending → running → completed
                          ↘ failed
                          ↘ pending（需下一步，taskId 不变）
```

**注意：** `running` = 正在执行中。

---

## 5. 目录结构

```
workspaceRoot/                   ← 可配置（openclaw.json 中设置）
├── tasks/
│   └── {taskId}/
│       └── task.json             ← 任务详情（唯一真实数据源）
│       └── {产出文件}            ← executor 写入的任务文件夹
└── queue/
    └── tasks.json               ← 任务ID索引列表
```

- `tasks/` 下每个 taskId 一个目录，存放 task.json 和执行产出
- `queue/tasks.json` 是全局索引，包含所有 taskId 列表
- **task.json 是唯一真实数据源**，其他都是衍生数据

---

## 6. Tool API

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务（原子操作，防并发竞态） |
| `mteam_update_task` | 执行者 | 更新状态/追加 context 步骤 |
| `mteam_get_pending` | 执行者 | 获取待认领任务列表（agent有任务时返回空） |
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
// 返回: { claimed: true, taskId: "...", runId: "...", sessionKey: "mteam:{taskId}:executor" }
// 原子操作：锁文件 + 状态校验，确保只有一个 agent 能抢到
// Plugin 内部通过 api.runtime.subagent.run() 直接创建 executor session
// sessionKey 格式: mteam:{taskId}:executor
// 创建成功后返回 runId 和 sessionKey
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

### 6.4 并发竞态保护

`claimTask` 使用锁文件（`.lock`）+ `flag: 'wx'` 原子操作：

1. 尝试创建 `tasks/{taskId}/.lock`，成功则持有锁
2. 持有锁后检查 `status === 'pending'`
3. 通过则更新状态并释放锁
4. 其他 agent 在第 1 步失败，直接返回 false

### 6.5 心跳机制

agent 执行中定期更新 `lastHeartbeatAt`：
- 超过 30 分钟未更新 → 任务视为疑似僵尸
- 由 agent 自行判断是否释放任务重新放回池子

---

## 7. 心跳检查流程

每个 agent 在心跳时自动检查任务池，不需要额外配置。

```
1. mteam_get_agent_active({ agentId })
2. 有 running 任务？
   └── 有 → update_task({ lastHeartbeatAt: Date.now() }) 更新心跳，跳过
3. 无 running 任务 → mteam_get_pending({ agentId })
   └── 有待认领 → claim_task（直接进入 running）
```

**约束：agent 不能同时做多个任务**

- `getPendingTasks(agentId)` 查询时，若 agent 已有 running 任务，返回空列表
- 查询进行中任务：`mteam_get_agent_active({ agentId })`

---

## 8. 技术细节

### 8.1 源码结构

```
src/
├── index.js          # 插件入口，注册 7 个 tools
│                      # 使用 Typebox 参数定义 + SDK helpers
├── schema/
│   ├── task.js        # 任务格式定义、验证、格式化（纯函数，可单元测试）
│   └── task.test.js   # Vitest 单元测试（26 个用例，全部通过）
└── queue/
    └── index.js       # 任务池核心操作（publishTask/claimTask/updateTask 等）
```

### 8.2 构建

```bash
npm run build    # esbuild bundle 到 dist/index.js
```

esbuild 配置：
- `platform=node` + `format=esm`
- `external:node:*` / `openclaw` / `openclaw/plugin-sdk`
- bundle 大小约 122KB（含 @sinclair/typebox runtime）

### 8.3 测试

```bash
npm run test     # watch 模式
npm run test:run # 单次运行
```

当前测试覆盖：src/schema/task.js 的所有纯函数。

### 8.4 安装路径

- **WSL 构建路径**：`~/code/m-team/`（权限干净，755）
- **OpenClaw 安装路径**：`~/.openclaw/extensions/m-team/`（由 `openclaw plugins install` 管理）
- **工作目录**：`/home/hjl/.openclaw/m-team/`（tasks/ 和 queue/ 在此）

**重要：开发代码在 `/mnt/d/code/m-team`，不要直接改 `~/.openclaw/extensions/m-team/`**

---

## 9. 配置文件

`openclaw.json` 中的插件配置：

```json
{
  "plugins": {
    "entries": {
      "m-team": {
        "enabled": true,
        "config": {
          "workspaceRoot": "/home/hjl/.openclaw/m-team"
        }
      }
    }
  }
}
```

---

## 10. 双 Session 模型

M-Team 使用两个独立的 OpenClaw Session，它们之间没有任何消息传递机制：

### 两个 Session

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、维护心跳、认领任务 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部通过 `api.runtime.subagent.run()` 创建 | 实际执行任务 | 任务级 |

### 关键约束

- **Plugin 内部创建**：`mteam_claim_task` 在 claim 成功后直接调用 `api.runtime.subagent.run()`，无需 executor agent 单独操作
- **sessionKey 格式**：`mteam:{taskId}:executor`，心跳 session 通过解析此格式提取 taskId
- **完全独立**：Executor session 完成后不通知 Heartbeat session；Heartbeat 靠 `lastHeartbeatAt` + 轮询 `mteam_get_agent_active` 判断状态
- **无跨 Session 回调**：这是 OpenClaw Gateway 的设计约束，任何"任务完成后通知心跳"的逻辑都需要自己实现（如 executor 完成任务后主动写心跳）

### 时序

```
Heartbeat Session                Executor Session
─────────────────              ─────────────────
mteam_claim_task()
  ├─ claimTask()
  └─ api.runtime.subagent.run()
       sessionKey="mteam:task123:executor"
       message="[M-Team Task...]"        ← 启动 executor agent
       ← ~100ms 创建确认
  return { taskId, runId, sessionKey }

mteam_update_task({ heartbeat })
sleep(10min)                     [executor 跑任务]

sleep(10min)                     [executor 完成，session 空闲]
mteam_get_agent_active()
  → lastHeartbeatAt 旧值 → 疑似僵尸
  → 下一轮发现 status=completed → 不 relinquish
```

---

## 11. 关键原则

1. **schema 固定，路径可配置** — task.js 只定义任务格式，workspaceRoot 是唯一配置项
2. **去中心化 = 没有单点** — 任务池是共享的，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不要让任务卡在 running
6. **context 无限追溯** — 每步 output 追加到 context，不丢历史

---

## 12. 已知限制

- ~~并发竞态~~ — ✅ 已用锁文件解决
- ~~暂无超时机制~~ — ✅ 心跳机制解决
- 任务积压：心跳间隔内任务可能被多个 agent 同时看到，需尽快 claim
