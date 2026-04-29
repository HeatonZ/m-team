---
name: m-team-publisher
description: "Use when: (1) user says '帮我做xxx' / '发个任务' / '发布到m-team', OR (2) user wants to delegate a multi-step task to other agents. This skill transforms a vague request into a structured task and publishes it to the pool."
version: 1.1.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [m-team, task-publish, multi-agent, autonomous-agents]
    related_skills: [m-team-executor, skill-triggering, task-delegation]
---

# M-Team Publisher Playbook

## When to Use This Skill

Trigger when user says things like:
- "帮我做xxx" / "发个任务"
- "发布到m-team" / "交给别人做"
- "这个任务太麻烦了，帮我分发一下"

**Do NOT use when:**
- User wants you to do it yourself
- Task is a single-step question (no meaningful subtask decomposition)
- User explicitly says "你自己做"

---

## Decision Tree

```
User wants to offload a task
    ↓
This skill activates
    ↓
Step 1: Clarify goal / input / description
    ↓
Step 2: Validate before publishing
    ↓
Step 3: mteam_publish_task({ description, goal, input, publisher, priority })
    ↓
Step 4: Done. Exit. No tracking.
    ↓
Executor picks it up via heartbeat → executes → notifies on complete
```

---

## Step 1: Extract Three Fields

| Field | Meaning | Rule |
|-------|---------|------|
| `goal` | The immutable end state | What the user ultimately wants |
| `input` | Execution parameters | Keywords, count, files — whatever the first step needs |
| `description` | What the next executor should do **right now** | Must be specific enough that a cold agent can act on it immediately |

**Goal vs Description:**

```
Goal: "找到收纳箱Top10供应商报价单"       ←终点，不可拆
Description: "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接"  ←第一步，可执行
```

If `description` describes the entire goal, the task is too small to benefit from the pool.

---

## Step 2: Validate Before Publishing

Ask if unclear:

- Goal 模糊？→ 先澄清再发
- Input 参数不全？→ 补全再发
- description 太笼统（>3句）？→ 拆成更细的第一步

---

## Step 3: Publish

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接",
  goal: "找到收纳箱Top10供应商报价单",
  input: { keyword: "收纳箱", count: 10 },
  publisher: "user"   // or specific agentId like "manager"
})
```

---

## Step 4: Done — No Tracking

After publishing:
- **Do not** poll `mteam_get_all_tasks`
- **Do not** check status periodically
- **Do not** wait for completion

The Executor handles execution. When done, the plugin sends notifications per `notifications` config.

---

## Anti-Patterns

| Wrong | Correct |
|-------|---------|
| description = "完成供应商调研" | description = concrete first step, ≤2 sentences |
| goal = description | Means task is one-step, doesn't need the pool |
| Missing input parameters | Always include `{ keyword, count, file }` as needed |
| publisher = agentId instead of "user" | Use "user" unless explicitly assigning to specific agent |
