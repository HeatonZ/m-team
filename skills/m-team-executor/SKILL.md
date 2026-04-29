---
name: m-team-executor
description: M-Team 任务执行技能——当 agent 认领了 M-Team 任务后触发。执行当前步骤→判断完成/接力/放弃。
triggers:
  - mteam_claim_task
  - 认领了任务
  - 执行任务
  - mteam_update_task
  - 任务放回池子
  - 接力执行
---

# M-Team 任务执行

## What

认领任务后执行当前步骤，判断是否完成、是否接力、是否放弃。

## When

- `mteam_claim_task` 返回成功后
- 开始执行 `description` 中的步骤前

## Step 1：认领并读取 context

认领成功后，读取任务详情：

```javascript
mteam_get_task({ taskId: "xxx" })
```

**有 context 历史？** 说明是接力任务：

```json
"context": [
  { "type": "input", "data": { "keyword": "收纳箱" } },
  { "executor": "maker", "step": "搜索供应商", "output": { "summary": "找到10家" }, "completedAt": 1745621000 }
]
```

→ 从 context 了解完整链路，只做下一步，不重复已完成的工作。

## Step 2：执行当前步骤

按 `description` 执行。只做这一件事，不要扩大范围。

## Step 3：判断结果（三岔口）

```
执行完毕
    │
    ├─► 核心目标达成了？
    │     └─► 是 → 更新 status="completed"，结束
    │
    ├─► 做了有用的事（没完全达成goal）？
    │     └─► 是 → status="pending"，追加 contextStep，放回池子接力
    │
    └─► 完全没进展？
          └─► 调用 relinquish_task，不写无效 context
```

**完成（goal 达成）：**

```javascript
mteam_update_task({
  taskId: "xxx",
  agentId: "maker",
  status: "completed",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

**接力（做了有用的事，没完全达成）：**

```javascript
mteam_update_task({
  taskId: "xxx",
  agentId: "maker",
  status: "pending",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] },
  description: "联系这10家供应商确认价格和MOQ"
})
```

→ `executor` 自动置空，下一个 agent 继续。

**放弃（完全没进展）：**

```javascript
mteam_relinquish_task({ taskId: "xxx", agentId: "maker" })
```

→ 不写 contextStep，避免伪造进度记录。

## Step 4：心跳保活

每 5 分钟更新一次：

```javascript
mteam_update_task({ taskId: "xxx", lastHeartbeatAt: Date.now() })
```

- 超过 30 分钟未更新 → 疑似僵尸
- 超过 60 分钟 → 调用 `relinquish_task`

**心跳 ≠ 进度。** 进度看 `contextStep` 有没有追加。

## 接力规则

| 情况 | 操作 |
|------|------|
| 当前步骤做完了，没达到 goal | 接力放回 |
| 当前步骤做完了，达到 goal | completed |
| 遇到障碍但能绕过去 | 自己绕，继续 |
| 遇到障碍绕不过去 | relinquish |
| 完全没做 | relinquish，不写假 context |

## 产出文件规范

写入任务文件夹，只存相对路径：

```
{workspaceRoot}/tasks/{taskId}/
├── task.json
└── data/
    ├── suppliers.json
    └── contact_log.md
```
