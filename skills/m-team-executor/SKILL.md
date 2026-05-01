---
name: m-team-executor
description: "Use when: (1) you just called mteam_claim_task and got { success: true, taskId }, OR (2) your heartbeat found you have a running task. This skill is the executor's tool reference — how to call complete/relay/relinquish correctly."
version: 1.3.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [m-team, task-execute, multi-agent, autonomous-agents]
    related_skills: [m-team-publisher, skill-triggering, task-delegation]
---

# M-Team Executor — Tool Reference

> Heartbeat handles task discovery and keep-alive. This skill covers the three outcomes.

## Context Before Starting

Read `context` from `mteam_get_task({ taskId })`:
- **empty** → start from scratch
- **non-empty** → resume from last `executor`'s `contextStep`. Do NOT redo completed steps.

---

## Outcome A: Goal Achieved → mteam_complete_task

```javascript
mteam_complete_task({
  taskId: "xxx",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

| Param | Required | Notes |
|-------|----------|-------|
| `taskId` | yes | |
| `contextStep` | yes | 这一步做了什么（具体动作） |
| `contextOutput.summary` | no | 可验证的结果摘要 |
| `contextOutput.files` | no | 任务文件夹内的相对路径数组 |

---

## Outcome B: Goal Not Met → mteam_relay_task

```javascript
mteam_relay_task({
  taskId: "xxx",
  agentId: "maker",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

| Param | Required | Notes |
|-------|----------|-------|
| `taskId` | yes | |
| `agentId` | yes | 当前执行者 agentId |
| `contextStep` | yes | 这一步做了什么 |
| `contextOutput.summary` | no | 结果摘要 |
| `contextOutput.files` | no | 产出文件路径 |

Plugin 会自动把 `executor` 设为 `null`，任务变回 `pending`。

---

## Outcome C: No Progress → mteam_relinquish_task

```javascript
mteam_relinquish_task({
  taskId: "xxx",
  executorId: "maker"
})
```

| Param | Required | Notes |
|-------|----------|-------|
| `taskId` | yes | |
| `executorId` | yes | 当前执行者 ID（**不是 agentId**） |

→ **Do NOT add contextStep.** That corrupts the audit trail.

---

## Anti-Patterns

| Wrong | Correct |
|-------|---------|
| `mteam_update_task({ status: 'completed' })` | `mteam_complete_task({ ... })` |
| `mteam_update_task({ status: 'pending' })` for relay | `mteam_relay_task({ ... })` |
| `mteam_relinquish_task({ taskId, agentId })` | `mteam_relinquish_task({ taskId, executorId })` |
| Write fake contextStep on relinquish | Relinquish = no contextStep |
| Expand scope beyond description | Do one step, not the whole goal |
| `contextStep` empty or vague | Be specific about what was done |

---

## Output File Convention

Write to task folder, store relative paths in `contextOutput.files`:

```
{workspaceRoot}/tasks/{taskId}/
├── task.json
└── data/
    └── results.json
```
