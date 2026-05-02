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
| `goal` | 完整的任务终点描述 | executor 凭此判断接不接单，必须包含类型/平台/约束/验收标准/项目路径 |
| `input` | 执行参数 | keyword、count、projectId 等第一步需要的参数 |
| `description` | 当前这一步做什么 | 单步可执行，不超过 2 句 |

**Goal 填写规范（必须详细）：**
- 任务类型（选品 / 爬虫 / 文档 / 代码）
- 数据源和平台（1688 / Shopee / 什么站点）
- 关键约束（costPrice < 5 RMB、数量、截止时间）
- 验收标准摘要（输出什么文件/字段）
- 项目路径
- **客观视角**：描述"要达成什么"，不描述"谁让我做"或"为谁做"
  - ❌ "帮我调研供应商"
  - ❌ "Agent 自我介绍任务：体现 Manager 的风格"
  - ✅ "在飞书单聊中发送一条300字以内的自我介绍，包含角色定位和风格描述" 
  - ✅ "从1688筛选3个costPrice<5RMB的宠物玩具商品"

**Description 填写规范：**
- 只写当前 executor 要做的这一件事
- 格式：`动词 + 关键词 + 筛选条件 + 输出路径`
- **客观视角**：描述"要做什么"，不描述"谁让我做"或"为谁做"
  - ❌ "帮我搜索宠物玩具" / "用户要选品"
  - ✅ "搜索宠物玩具关键词，筛选 costPrice < 5 RMB"
  - ❌ "publisher=manager 要做调研报告"
  - ✅ "抓取商品详情页，输出到 {projectId}/{taskId}/detail.json"

**Goal vs Description 示例：**

```
goal: "为 Shopee 马来西亚站点从 1688 选 3 个宠物玩具，costPrice < 5 RMB，
      完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
      图片去背景处理，项目路径 /mnt/d/code/projects/T-20250430-001/"
description: "搜索宠物玩具关键词，筛选 costPrice < 5 RMB 的商品，取 top 5 中符合条件的 3 个，
              输出 {projectId}/{taskId}/selection-search/{taskId}_data.json"
```

**常见错误：**
- description = 整个任务 → task 太小，不需要池子
- goal = description → executor 无法判断是否适合接单

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
  description: "搜索宠物玩具关键词，筛选 costPrice < 5 RMB 的商品，取 top 5 中符合条件的 3 个，输出 {projectId}/{taskId}/selection-search/{taskId}_data.json",
  goal: "为 Shopee 马来西亚站点从 1688 选 3 个宠物玩具，costPrice < 5 RMB，完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），图片去背景处理，项目路径 /mnt/d/code/projects/T-20250430-001/",
  input: { keyword: "宠物玩具", maxCostPriceRmb: 5, quantity: 3, projectId: "T-20250430-001", platform: "shopee_malaysia" },
  publisher: "manager",
  priority: "high"
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
| description 出现 publisher 身份、角色定位、
"帮我做xxx"、"体现xx的风格" | description 只写客观执行指令，不出现
"谁让我做"或"为谁做"的信息 |
| goal = description | Means task is one-step, doesn't need the pool |
| Missing input parameters | Always include `{ keyword, count, file }` as needed |
| publisher = agentId instead of "user" | Use "user" unless explicitly assigning to specific agent |
