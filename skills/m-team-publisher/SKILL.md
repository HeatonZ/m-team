---
name: m-team-publisher
description: "Use when: (1) user says '帮我做xxx' / '发个任务' / '发布到m-team', OR (2) user wants to delegate a multi-step task to other agents, OR (3) user asks another agent to do something that requires context from a third party (e.g. '在飞书发条消息体现Manager的风格'). This skill transforms a vague request into a structured task and publishes it to the pool."
version: 1.2.0
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
- "帮我做xxx" / "发个任务" / "发布到m-team" / "交给别人做"
- "这个任务太麻烦了，帮我分发一下"
- "你帮我去飞书发一条" / "发到群里"
- 任何要求另一个 agent 执行而 executor 没有人设上下文才能理解的任务

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
Step 2: Run PUBLISH CHECKLIST — all items must pass
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
| `goal` | 完整的任务终点描述 | executor 凭此判断接不接单，必须包含类型/平台/约束/验收标准 |
| `input` | 执行参数 | keyword、count 等第一步需要的参数 |
| `description` | 当前这一步做什么 | 单步可执行，不超过 2 句 |

**Goal 填写规范（必须详细）：**
- 任务类型（选品 / 爬虫 / 文档 / 代码）
- 数据源和平台（1688 / Shopee / 什么站点）
- 关键约束（costPrice < 5 RMB、数量、截止时间）
- 验收标准摘要（输出什么文件/字段）
- **无项目路径**：输出到任务文件夹 `{workspaceRoot}/tasks/{taskId}/`，不是项目目录
- **客观视角**：描述"要达成什么"，不描述"谁让我做"或"为谁做"
  - ❌ "帮我调研供应商"
  - ❌ "Agent 自我介绍任务：体现 Manager 的风格"
  - ❌ "在飞书发一条，体现孔明的角色定位"
  - ✅ "在飞书单聊中发送一条300字以内的自我介绍，包含角色定位和风格描述"
  - ✅ "从1688筛选3个costPrice<5RMB的宠物玩具商品"

**Description 填写规范：**
- 只写当前 executor 要做的这一件事，**不写输出格式和路径**，**不写发送渠道**
- 格式：`动词 + 关键词 + 筛选条件`
- **客观视角**：描述"要做什么"，不描述"谁让我做"或"为谁做"
  - ❌ "帮我搜索宠物玩具" / "用户要选品"
  - ❌ "发一条自我介绍消息，体现 Manager 的风格"
  - ❌ "输出到 /tmp/result.json" / "生成 CSV 格式" / "保存为 a.txt"
  - ❌ "发到飞书群" / "发 Discord" / "发送到群里"
  - ✅ "搜索宠物玩具关键词，筛选 costPrice < 5 RMB"
  - ✅ "抓取商品详情页"

**Goal vs Description 示例：**

```
goal: "为 Shopee 马来西亚站点从 1688 选 3 个宠物玩具，costPrice < 5 RMB，
      完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
      图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/"
description: "搜索宠物玩具关键词，筛选 costPrice < 5 RMB 的商品，取 top 5 中符合条件的 3 个"
```

---

## Step 2: PUBLISH CHECKLIST（强制检查清单）

**逐项确认，每一项都必须为"是"才能调用 mteam_publish_task。若任一项为"否"，先修正再发布，不要跳过。**

| # | 检查项 | 自检问题 |
|---|--------|---------|
| 1 | goal 自包含 | goal 描述的是**结果状态**（发送了什么、筛选了什么），而不是"谁做"或"给谁看"？ |
| 2 | goal 无执行者身份 | goal 中不出现"Agent xxx 任务"、"体现 xxx 风格/角色"、"给 xxx 看的"？ |
| 3 | description 是单步动作 | description 描述的是**一个具体动作**，不超过 2 句？ |
| 4 | description 与 goal 不重复 | description 写的是"这一步做什么"，goal 写的是"任务终点"，两者不同？ |
| 5 | input 参数完整 | executor 看完 description + input 能直接开始执行，不需要再问发布者？ |
| 6 | 任务适合池子 | 任务是否需要多步或跨时段执行？单步即时完成的任务不需要发池子？ |
| 7 | description 不写输出格式/路径 | description 中不出现文件路径、扩展名、输出格式关键词（"输出到"、"生成 CSV"、"保存为"）？ |
| 8 | description 不写发送渠道 | description 中不出现"发到飞书"、"发Discord"、"发送到群"等渠道关键词，由 executor 自己决定用什么渠道？ |

**常见错误对应的检查项：**

| 错误 | 未通过的检查项 |
|------|--------------|
| goal = "Agent 自我介绍任务：体现 Manager 风格" | #1, #2 |
| description = "在飞书发一条自我介绍"（无上下文） | #2, #5 |
| description = goal（两者完全相同） | #4 |
| 任务一步就能完成但发到了池子 | #6 |

---

## Step 3: Publish

```javascript
mteam_publish_task({
  description: "搜索宠物玩具关键词，筛选 costPrice < 5 RMB 的商品，取 top 5 中符合条件的 3 个",
  goal: "为 Shopee 马来西亚站点从 1688 选 3 个宠物玩具，costPrice < 5 RMB，完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/",
  input: { keyword: "宠物玩具", maxCostPriceRmb: 5, quantity: 3, platform: "shopee_malaysia" },
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
| goal = "Agent 自我介绍任务：体现 Manager 风格" | goal = "发送一条300字以内的自我介绍" |
| goal = "收到任务的 agent 完成自我介绍" | goal = 具体可验证的结果描述 |
| description = "发到飞书群" / "发 Discord" | description = "发送消息"（executor 自己决定渠道） |
| description = goal | description 写第一步，goal 写任务终点 |
| description = "输出到 /tmp/result.json" | description = "抓取页面数据"（executor 自己决定输出到任务文件夹） |
| goal = "帮我调研供应商" | goal = "从1688筛选3家供应商，输出到 {workspaceRoot}/tasks/{taskId}/" |
| Missing input parameters | Always include `{ keyword, count, chat_id, ... }` as needed |
| publisher = agentId instead of "user" | Use "user" unless explicitly assigning to specific agent |
