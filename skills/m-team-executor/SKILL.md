---
name: m-team-executor
description: "Use when agent has claimed a M-Team task via mteam_claim_task. Executes the current step, then decides: complete / relay / relinquish."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [m-team, task-execute, multi-agent, autonomous-agents]
    related_skills: [m-team-publisher, skill-triggering, task-delegation]
---

# M-Team Executor

## Overview

After claiming a task from the M-Team pool, the Executor reads the task context, executes the current step described in `description`, then makes a three-way decision: complete (goal met), relay (did useful work but goal not met, return to pool), or relinquish (no progress made). Heartbeat keeps the task alive during execution.

## When to Use

- `mteam_claim_task` returned successfully
- About to start work on `description`
- Checking progress after a work session
- Deciding whether to continue or return a task

**Do NOT use when:**
- Task has `status: cancelled` (不可 relay)
- Task belongs to a different executor (check `mteam_get_agent_active`)
- No active task to work on

## Step 1: Read Task and Context

```javascript
mteam_get_task({ taskId: "xxx" })
```

If `context` is non-empty, this is a relay — prior executors left their output:

```json
"context": [
  { "type": "input", "data": { "keyword": "收纳箱" } },
  { "executor": "maker", "step": "搜索供应商", "output": { "summary": "找到10家" }, "completedAt": 1745621000 }
]
```

→ Resume from where the last executor stopped. Do NOT repeat已完成步骤.

## Step 2: Execute the Current Step

Execute exactly what `description` says. One step only — do not expand scope.

## Step 3: Three-Way Decision

```
After executing description:
    │
    ├─► Goal achieved?
    │     └─ YES → status = "completed"
    │
    ├─► Did useful work (goal not met)?
    │     └─ YES → status = "pending" + contextStep + contextOutput (relay)
    │
    └─► No progress at all?
          └─ YES → mteam_relinquish_task (no fake context)
```

**Complete (goal met):**

```javascript
mteam_update_task({
  taskId: "xxx",
  agentId: "maker",
  status: "completed",
  contextStep: "搜索1688供应商",
  contextOutput: { summary: "找到10家供应商", files: ["data/suppliers.json"] }
})
```

**Relay (useful work done, goal not met):**

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
→ `executor` is auto-cleared; next agent picks it up.

**Relinquish (no progress):**

```javascript
mteam_relinquish_task({ taskId: "xxx", agentId: "maker" })
```
→ Do NOT write a fake `contextStep`. That corrupts the audit trail.

## Step 4: Heartbeat

Every 5 minutes while working:

```javascript
mteam_update_task({ taskId: "xxx", lastHeartbeatAt: Date.now() })
```

| Threshold | Meaning | Action |
|-----------|---------|--------|
| > 30 min since last heartbeat | Possibly zombie | Monitor closely |
| > 60 min since last heartbeat | Dead task | `mteam_relinquish_task` |

**Heartbeat ≠ progress.** Progress = `contextStep` was appended. Heartbeat only says "I'm still alive."

## Relay Rules

| Situation | Action |
|-----------|--------|
| Step done, goal not met | Relay with contextStep |
| Step done, goal met | Completed |
| Blocked but can work around | Continue on own |
| Blocked, cannot work around | Relinquish |
| Did nothing | Relinquish, no fake context |

## Output File Convention

Write outputs to the task folder, store relative paths in `contextOutput.files`:

```
{workspaceRoot}/tasks/{taskId}/
├── task.json
└── data/
    ├── suppliers.json
    └── contact_log.md
```

## Common Pitfalls

1. **Writing fake contextStep on relinquish** — corrupts history. Relinquish = no `contextStep`.
2. **Expanding scope beyond description** — executor should do one step, not the whole goal.
3. **Forgetting to clear executor on relay** — plugin clears automatically, but if manual `mteam_update_task`, set `executor: null`.
4. **Heartbeat not updated during long tasks** — task looks zombie even when working. Update every 5 min.
5. **Treating heartbeat as progress** — if no new `contextStep` added, no real progress was made.

## Verification Checklist

- [ ] Read `context` before starting (know relay history)
- [ ] Executed exactly what `description` asked
- [ ] Decision matches reality (complete / relay / relinquish)
- [ ] Relay includes `contextStep` + `contextOutput`
- [ ] Relinquish has NO `contextStep`
- [ ] Heartbeat updated every 5 min during work
- [ ] Output files use correct relative path convention
