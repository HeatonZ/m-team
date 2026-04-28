# M-Team 去中心化任务池协作 — 架构文档

> 版本：1.0.1 | 更新：2026-04-27

---

## 1. 设计目标

**目标：** 多 agent（孔明/captain/maker/scholar）在没有中心协调者的情况下，通过共享任务池自主协作。

核心思路：
- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — 任务池是文件系统中的队列，节点自主读写

---

## 2. 架构图

```
┌─────────┐
│  CEO    │  发起需求
└────┬────┘
     │ (私聊/群聊)
     ▼
┌─────────┐
│  孔明   │  确认需求 → mteam_publish_task() → 写入队列
└────┬────┘
     │ 文件系统
     ▼
┌─────────────────────────────────┐
│      任务池 (tasks.json)        │  共享文件
└────┬────────────────────────────┘
     │ 心跳轮询
     ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ captain │ │  maker  │ │ scholar │  自主认领 (mteam_claim_task)
└────┬────┘ └────┬────┘ └────┬────┘
     │            │           │
     ▼            ▼           ▼
┌─────────────────────────────────┐
│   任务执行 + 产出写入 tasks/    │
└────┬────────────────────────────┘
     │ mteam_update_task(status=completed)
     ▼
┌─────────────────────────────────┐
│   任务池状态更新                │
└─────────────────────────────────┘
```

---

## 3. 角色定义

| 角色 | Agent ID | 职责 | 能力标签 |
|------|----------|------|---------|
| 孔明 | konming | 接收 CEO 需求，确认后发布任务 | publisher |
| captain | captain | 选品/货源/市场/竞品调研 | captain |
| maker | maker | 制作内容/列表/文档 | maker |
| scholar | scholar | 知识整理/分析/评分 | scholar |

> 注：能力标签（requiredCapability）用于过滤任务，一个任务只能由对应能力的 agent 认领。

---

## 4. 任务格式（固定，不可修改）

```json
{
  "taskId": "task_{timestamp}_{random6}",
  "description": "任务描述",
  "input": { /* 任务参数 */ },
  "requiredCapability": "captain | maker | scholar | general",
  "priority": "high | normal | low",
  "initiator": "ceo | konming | agentId",
  "status": "pending | claimed | running | completed | failed",
  "owner": null | "agentId",
  "createdAt": 1745740800000,
  "claimedAt": null | 1745740800100,
  "completedAt": null | 1745740800200,
  "lastHeartbeatAt": null | 1745740800500,
  "summary": null | "结果摘要（≤200字）",
  "result": null | { /* 完整结果 */ }
}
```

 **优先级（可选，默认 normal）：**
| 值 | 说明 |
|----|------|
| `high` | 🔴 高优先级，优先处理 |
| `normal` | 🟡 中优先级，默认 |
| `low` | 🟢 低优先级 |

**状态流转：**
```
pending → claimed → running → completed
                         ↘ failed
                         ↘ pending (需下一步)
```

**特殊流转：需下一步**
当任务完成后发现还需要继续（如 CEO 审核、补充信息、迭代），
由任意节点调用 `mteam_update_task` 将状态改回 `pending`，
并更新 `description` 为新的需求描述。

**注意：taskId 保持不变**，这样下一个执行者能读到之前的 context 和 result。

状态流转变为：
```
pending → claimed → running → completed
                         ↘ failed
                         ↘ pending（taskId 不变，description 更新）
```

---

## 5. 目录结构

```
/mnt/d/code/m-team/           ← workspaceRoot（可配置）
├── index.js                  ← 插件入口，注册 tools
├── openclaw.plugin.json      ← 插件配置
├── schema/
│   └── task.js              ← 固定任务格式 + 验证工具
├── queue/
│   └── index.js             ← 任务池核心操作
│
├── tasks/                   ← 任务工作目录（自动创建）
│   └── {taskId}/
│       ├── task.json        ← 任务详情（只读）
│       ├── result.json      ← 执行结果
│       └── {产出文件}       ← 其他产出
│
└── queue/                   ← 队列索引（自动创建）
    └── tasks.json           ← 任务ID列表索引
```

**唯一可配置项：** `workspaceRoot`（在 openclaw.json 中设置）

---

## 6. Tool API

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 孔明 | 发布新任务（支持 priority） |
| `mteam_claim_task` | 执行者 | 认领任务（原子操作，防并发竞态） |
| `mteam_update_task` | 执行者 | 更新状态/心跳（status 非必填） |
| `mteam_get_pending` | 执行者 | 获取待认领任务列表（agent有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中的任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_get_all_tasks` | 任意 | 获取所有任务 |

### 6.1 发布任务

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商",
  requiredCapability: "captain",
  input: { keyword: "收纳箱", count: 10 },
  initiator: "ceo"
})
// 返回: { taskId: "task_1745740800000_abc123" }
```

### 6.2 认领任务

```javascript
mteam_claim_task({
  taskId: "task_1745740800000_abc123",
  agentId: "captain"
})
// 返回: { claimed: true, taskId: "..." }
// 原子操作：检查状态+能力匹配后才认领
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

`claimTask` 使用锁文件（`.lock`）+ `flag: 'wx'` 原子操作，确保只有一个 agent 能抢到任务。

### 6.5 心跳机制

agent 执行中定期更新 `lastHeartbeatAt`：
- 超过 30 分钟未更新 → 任务视为疑似僵尸
- 由 agent 自行判断是否释放任务重新放回池子

---

## 7. 执行者心跳流程

每个执行者（captain/maker/scholar）需在 HEARTBEAT.md 中配置任务池检查。

### 状态说明

| 状态 | 含义 | 心跳要求 |
|------|------|---------|
| `pending` | 待认领，没人抢 | - |
| `claimed` | 已认领，还没开始执行 | 立即转 `running` |
| `running` | 正在执行 | 定期更新 `lastHeartbeatAt` |
| `completed` | 已完成 | - |
| `failed` | 失败 | - |

**`claimed` ≠ 正在执行！** 认领后必须立即转 `running`。

### HEARTBEAT 检查流程

```
1. mteam_get_agent_active({ agentId })
2. 有任务？
   ├── status='claimed' → update_task({ status: 'running' })，开始执行
   ├── status='running' → 检查 lastHeartbeatAt：
   │   ├── 超过30分钟 → update_task({ status: 'pending' }) 释放，重新抢
   │   ├── 30分钟内 → 执行中，跳过
   └── 无任务 → 第3步
3. mteam_get_pending({ agentId })
   └── 有任务？→ claim_task → update_task({ status: 'running' })
```

### 心跳更新（执行中）

每完成一个子步骤，调用：
```
mteam_update_task({ taskId, lastHeartbeatAt: Date.now() })
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

**旧模型废弃清单：**
- `skills/chain-common/`
- `skills/chain-coordinator/`
- `skills/chain-executor/`
- `skills/chain-status/`
- `index.js`（旧插件入口）
- `skills/task-admin/`
- `agents/` 目录

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
          "workspaceRoot": "/mnt/d/code/m-team"
        }
      }
    }
  }
}
```

---

## 10. 待完成事项

- [ ] 注册 OpenClaw tools（mteam_publish_task / mteam_claim_task / mteam_update_task 等）✅ 已实现
- [ ] 打通 plugin 配置读取（openclaw.json 中 plugins.entries.m-team.config）✅ 已实现
- [ ] 清理测试残留文件（/mnt/d/code/m-team/tasks/）
- [ ] 打通 captain/maker/scholar 的 HEARTBEAT.md 配置
- [ ] 测试完整链路：CEO→孔明→发布→captain认领→回报

---

## 11. 关键原则

1. **schema 固定，路径可配置** — task.js 只定义任务格式，workspaceRoot 是唯一配置项
2. **去中心化 = 没有单点** — 任务池是共享的，节点自主抢
3. **心跳驱动** — agent 不需要被 @，自己心跳查任务池
4. **产出写任务文件夹** — 便于追溯和清理
5. **状态必须流转** — 不要让任务卡在 claimed/running

---

## 12. 已知限制

- ~~并发竞态~~ ✅ 已用锁文件解决
- ~~暂无超时机制~~ ✅ 心跳机制解决（agent 自行判断是否释放）
- 任务积压：心跳间隔内任务可能被多个 agent 同时看到，需尽快 claim
