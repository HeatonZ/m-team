---
name: m-team-publisher
description: Use when user wants to publish a task to M-Team decentralized task pool. Analyzes requirements, extracts goal/input/description, calls mteam_publish_task, then exits without tracking.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [m-team, task-publish, multi-agent, autonomous-agents]
    related_skills: [m-team-executor, skill-triggering, task-delegation]
---

# M-Team Publisher

## Overview

When a user wants to offload a task to the M-Team decentralized pool, this skill transforms a vague request into a structured task entry. Publisher analyzes the goal, extracts the first executable step as `description`, publishes via `mteam_publish_task`, then walks away — no tracking, no polling. Execution is handled by Executors; completion is pushed via notification.

## When to Use

- User says "帮我做xxx" or "发个任务"
- User says "发布到m-team" or "把这个交给别人做"
- User asks to delegate a multi-step task to other agents
- `mteam_publish_task` tool is available and user wants task offloading

**Do NOT use when:**
- User wants you to do it yourself (no delegation needed)
- Task is a single-step question with no meaningful subtask decomposition
- User explicitly says "你自己做"

## Step 1: Analyze the Request

Confirm three fields before publishing:

| Field | Meaning | Rule |
|-------|---------|------|
| `goal` | The不可更改的最终状态 | What the user ultimately wants |
| `input` | Execution parameters | Keywords, count, files — whatever the first step needs |
| `description` | What the next executor should do **right now** | Must be specific enough that a cold agent can act on it immediately |

**Goal vs Description distinction:**

```
Goal: "找到收纳箱Top10供应商报价单"   ← 终点，不可拆
Description: "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接"  ← 第一步，可执行
```

If `description` describes the entire goal, it means the task is too small to benefit from the pool.

## Step 2: Validate Before Publishing

Ask if unclear:

- Goal 模糊？→ 先澄清再发
- Input 参数不全？→ 补全再发
- description 太笼统（>3句）？→ 拆成更细的第一步

## Step 3: Publish

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接",
  goal: "找到收纳箱Top10供应商报价单",
  input: { keyword: "收纳箱", count: 10 },
  publisher: "user"   // or specific agentId
})
```

## Step 4: Done — No Tracking

After publishing:

- **Do not** poll `mteam_get_all_tasks`
- **Do not** check status periodically
- **Do not** wait for completion

The Executor handles execution. When done, the plugin sends notifications per `notifications` config. Publisher's job is finished at Step 3.

## Common Pitfalls

1. **description 太模糊** — e.g. "完成供应商调研" → executor 不知道具体做什么. Fix: break into concrete first step.
2. **goal 和 description 一样** — means task is one-step, doesn't need the pool. Fix: either do it yourself or define a real multi-step goal.
3. **input 参数缺失** — executor gets task but lacks enough info to act. Fix: always include `{ keyword, count, file }` as appropriate.
4. **publisher 写 agentId 而不是 "user"** — unless explicitly assigning to a specific agent, use "user" to mean "user-initiated".

## Verification Checklist

- [ ] `goal` is the true end state (not a step)
- [ ] `description` is the exact next action (≤2 sentences, concrete)
- [ ] `input` contains all parameters the first step needs
- [ ] `publisher` is correct ("user" or specific agentId)
- [ ] Task published without additional tracking
