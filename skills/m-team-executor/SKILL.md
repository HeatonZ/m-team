---
name: m-team-executor
description: "Use when: (1) you just called mteam_claim_task and got { success: true, taskId }, OR (2) your heartbeat found you have a running task. This skill is the playbook for executing one step, deciding outcome, and updating the pool."
version: 1.2.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [m-team, task-execute, multi-agent, autonomous-agents]
    related_skills: [m-team-publisher, skill-triggering, task-delegation]
---

# M-Team Executor Playbook

## How This Skill Is Used

```
YOU received a task via mteam_claim_task
    ↓
Read this skill → Follow the playbook
    ↓
Execute ONE step → Make a decision → Call the right tool
    ↓
Exit. Next agent picks up if needed.
```

## Decision Tree

```
Step 1: mteam_get_task({ taskId })
        ↓
   context non-empty?
    ├─ YES → Resume from last executor's output
    └─ NO  → Start from scratch
        ↓
Step 2: Execute exactly what description says
        ↓
   After execution:
   ┌─ Goal achieved? ─────────────→ mteam_complete_task()
   ├─ Useful work done, goal not met? → mteam_relay_task()
   └─ No progress at all? ─────────→ mteam_relinquish_task()
```

## Tool Reference

### Step 1: Read Task

```javascript
mteam_get_task({ taskId: "xxx" })
```

Returns `task` with fields: `taskId`, `description`, `goal`, `input`, `context`, `status`, `executor`, `createdAt`.

**If `context` is non-empty** → relay case:

```json
"context": [
  { "type": "input", "data": { "keyword": "收纳箱" } },
  { "executor": "maker", "step": "搜索供应商", "output": { "summary": "找到10家" }, "completedAt": 1745621000 }
]
```

→ Resume from where it stopped. Do NOT redo completed steps.

---

### Outcome A: Goal Achieved → mteam_complete_task

```javascript
mteam_complete_task({
  taskId: "xxx",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

**Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `taskId` | yes | 任务ID |
| `contextStep` | yes | 这一步做了什么（描述具体动作） |
| `contextOutput.summary` | no | 可验证的结果摘要 |
| `contextOutput.files` | no | 任务文件夹内的相对路径数组 |

---

### Outcome B: Useful Work Done, Goal Not Met → mteam_relay_task

```javascript
mteam_relay_task({
  taskId: "xxx",
  agentId: "maker",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

**Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `taskId` | yes | 任务ID |
| `agentId` | yes | 当前执行者 agentId |
| `contextStep` | yes | 这一步做了什么 |
| `contextOutput.summary` | no | 结果摘要 |
| `contextOutput.files` | no | 产出文件路径 |

→ Plugin 会自动把 `executor` 设为 `null`，任务变回 `pending`，下一个 agent 认领

---

### Outcome C: No Progress → mteam_relinquish_task

```javascript
mteam_relinquish_task({
  taskId: "xxx",
  executorId: "maker"
})
```

**Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `taskId` | yes | 任务ID |
| `executorId` | yes | 当前执行者 agentId（注意是 `executorId` 不是 `agentId`）|

→ **Do NOT add contextStep.** That corrupts the audit trail.

---

## Heartbeat While Working

If the task takes more than 5 minutes, update heartbeat via mteam_update_task:

```javascript
mteam_update_task({
  taskId: "xxx",
<<<<<<< Updated upstream
  agentId: "maker",
=======
>>>>>>> Stashed changes
  lastHeartbeatAt: Date.now()
})
```

<<<<<<< Updated upstream
Only these three fields — do NOT change status.

| Threshold | Meaning | Action |
|-----------|---------|--------|
| > 20 min no heartbeat | Possibly stuck | Monitor |
| > 40 min no heartbeat | Likely dead | `mteam_relinquish_task` |
=======
Only these two fields — do NOT change status.

| Threshold | Meaning | Action |
|-----------|---------|--------|
| > 30 min no heartbeat | Possibly zombie | Monitor |
| > 60 min no heartbeat | Dead task | `mteam_relinquish_task` |
>>>>>>> Stashed changes

**Heartbeat ≠ progress.** Progress means `contextStep` was added.

---

## Output File Convention

Write outputs to task folder, store relative paths in `contextOutput.files`:

```
{workspaceRoot}/tasks/{taskId}/
├── task.json
└── data/
    ├── suppliers.json
    └── contact_log.md
```

---

## Anti-Patterns

| Wrong | Correct |
|-------|---------|
| `mteam_update_task({ status: 'completed' })` | `mteam_complete_task({ ... })` |
| `mteam_update_task({ status: 'pending' })` for relay | `mteam_relay_task({ ... })` |
| `mteam_relinquish_task({ taskId, agentId })` | `mteam_relinquish_task({ taskId, executorId })` |
| Write fake contextStep on relinquish | Relinquish = no contextStep |
| Expand scope beyond description | Do one step, not the whole goal |
| Forget heartbeat during long tasks | Update every 5 min |

---

## Checklist Before Exiting

- [ ] Read `context` before starting (know relay history)
- [ ] Executed exactly what `description` asked
- [ ] Called correct tool (complete / relay / relinquish)
- [ ] Relay called `mteam_relay_task` with `contextStep` + `contextOutput`
- [ ] Relinquish called `mteam_relinquish_task` with NO contextStep
- [ ] Heartbeat updated if task took > 5 min
- [ ] Output files use correct relative path convention
