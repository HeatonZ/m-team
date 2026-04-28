# M-Team 架构文档

> 版本：1.1.0 | 更新：2026-04-28

---

## 1. 设计目标

多 agent 在没有中心协调者的情况下，通过共享任务池自主协作。

核心思路：
- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — 任务池是文件系统中的队列，节点自主读写

---

## 2. 架构图

```
┌─────────┐
│ Agent A │  发布任务
└────┬────┘
     │ mteam_publish_task
     ▼
┌─────────────────────────────────┐
│      任务池 (queue/tasks.json) │  共享文件
└────┬────────────────────────────┘
     │ mteam_claim_task
     ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Agent B │ │ Agent C │ │ Agent D │  自主认领
└────┬────┘ └────┬────┘ └────┬────┘
     │            │           │
     ▼            ▼           ▼
┌─────────────────────────────────┐
│   任务执行 + 产出写入 tasks/   │
└─────────────────────────────────┘
     │ mteam_update_task(status=completed)
     ▼
┌─────────────────────────────────┐
│   任务池状态更新                │
└─────────────────────────────────┘
```

---

## 3. 通用设计原则

- **任意 agent 可发布任务** — `publisher` 只是记录，不做权限控制
- **任意 agent 可认领任务** — 根据任务描述自行判断是否接单
- **agent 不能同时做多个任务** — 有进行中任务时不能认领新任务
- **心跳保活** — 执行中的任务定期更新 `lastHeartbeatAt`

---

## 4. 任务格式

```json
{
  "taskId": "task_{timestamp}_{random6}",
  "description": "任务描述",
  "input": { /* 任务参数 */ },
  "priority": "high | normal | low",
  "publisher": "user | agentId",
  "status": "pending | claimed | running | completed | failed",
  "executor": null | "agentId",
  "lastExecutor": null | "agentId",
  "createdAt": 1745740800000,
  "claimedAt": null | 1745740800100,
  "completedAt": null | 1745740800200,
  "lastHeartbeatAt": null | 1745740800500,
  "summary": null | "结果摘要（≤200字）",
  "result": null | { /* 完整结果 */ }
}
```

**优先级：**

| 值 | 说明 |
|----|------|
| `high` | 🔴 高优先级，优先处理 |
| `normal` | 🟡 中优先级，默认 |
| `low` | 🟢 低优先级 |

**状态流转：**

```
pending → claimed → running → completed
                         ↘ failed
                         ↘ pending（需下一步，taskId 不变）
```

**注意：** `claimed` ≠ 正在执行。认领后必须立即转 `running` 才是真正开始。

---

## 5. 目录结构

```
workspaceRoot/                   ← 可配置（openclaw.json 中设置）
├── tasks/
│   └── {taskId}/
│       └── task.json             ← 任务详情
└── queue/
    └── tasks.json               ← 任务ID索引列表
```

- `tasks/` 下每个 taskId 一个目录，存放 task.json 和执行产出
- `queue/tasks.json` 是全局索引，包含所有 taskId 列表
- **task.json 是唯一真实数据源**，其他都是衍生数据

---

## Tool API

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 任意 | 发布新任务（支持 priority） |
| `mteam_claim_task` | 执行者 | 认领任务（原子操作，防并发竞态） |
| `mteam_update_task` | 执行者 | 更新状态/心跳（status 非必填） |
| `mteam_get_pending` | 执行者 | 获取待认领任务列表（agent有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_get_all_tasks` | 任意 | 获取所有任务 |

### 6.1 发布任务

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
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
// 返回: { claimed: true, taskId: "..." }
// 原子操作：锁文件 + 状态校验，确保只有一个 agent 能抢到
```

### 6.3 更新状态

```javascript
mteam_update_task({
  taskId: "task_1745740800000_abc123",
  status: "completed",
  summary: "找到10个供应商",
  result: { suppliers: [...] }
})
```

**状态非必填，可只更新心跳：**

```javascript
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

### 心跳检查流程

```
1. mteam_get_agent_active({ agentId })
2. 有任务？
   ├── status='claimed' → update_task({ status: 'running' })，开始执行
   ├── status='running' → 检查 lastHeartbeatAt：
   │   ├── 超过30分钟 → update_task({ status: 'pending' }) 释放，重新抢
   │   └── 30分钟内 → 执行中，跳过
   └── 无任务 → 第3步
3. mteam_get_pending({ agentId })
   └── 有任务？→ claim_task → update_task({ status: 'running' })
```

### 约束：agent 不能同时做多个任务

- `getPendingTasks(agentId)` 查询时，若 agent 已有 claimed/running 任务，返回空列表
- 查询进行中任务：`mteam_get_agent_active({ agentId })`

---

## 8. 与旧链式模型的区别

| 维度 | 旧链式模型 | 新任务池模型 |
|------|-----------|-------------|
| 协调方式 | coordinator 发起 + 路由 | 无协调者，节点自主抢 |
| 通信方式 | sessions_send 点对点 | 共享文件系统 |
| 触发方式 | 被 @ 才响应 | 心跳轮询 |
| 任务分发 | coordinator 指定下一个 | 任意节点认领 |
| 单点故障 | coordinator 挂了链路断 | 无单点 |

---

## 9. 技术细节

### 9.1 源码结构

```
src/
├── index.js          # 插件入口，注册 7 个 tools
│                      # 使用 Typebox 参数定义 + SDK helpers
├── schema/
│   ├── task.js        # 任务格式定义、验证、格式化（纯函数，可单元测试）
│   └── task.test.js   # Vitest 单元测试（25 个用例，全部通过）
└── queue/
    └── index.js       # 任务池核心操作（publishTask/claimTask/updateTask 等）
```

### 9.2 构建

```bash
npm run build    # esbuild bundle 到 dist/index.js
```

esbuild 配置：
- `platform=node` + `format=esm`
- `external:node:*` / `openclaw` / `openclaw/plugin-sdk`
- bundle 大小约 122KB（含 @sinclair/typebox runtime）

### 9.3 测试

```bash
npm run test     # watch 模式
npm run test:run # 单次运行
```

当前测试覆盖：src/schema/task.js 的所有纯函数。

### 9.4 安装路径

- **WSL 构建路径**：`~/code/m-team/`（权限干净，755）
- **OpenClaw 安装路径**：`~/.openclaw/extensions/m-team/`（由 `openclaw plugins install` 管理）
- **工作目录**：`/home/hjl/.openclaw/m-team/`（tasks/ 和 queue/ 在此）

**重要：开发代码在 `/mnt/d/code/m-team`，不要直接改 `~/.openclaw/extensions/m-team/`**

---

## 10. 配置文件

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

## 11. 关键原则

1. **schema 固定，路径可配置** — task.js 只定义任务格式，workspaceRoot 是唯一配置项
2. **去中心化 = 没有单点** — 任务池是共享的，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不要让任务卡在 claimed/running

---

## 12. 已知限制

- ~~并发竞态~~ — ✅ 已用锁文件解决
- ~~暂无超时机制~~ — ✅ 心跳机制解决
- 任务积压：心跳间隔内任务可能被多个 agent 同时看到，需尽快 claim
