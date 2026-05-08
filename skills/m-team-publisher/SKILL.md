---
name: m-team-publisher
description: "Use when: (1) user says '帮我做xxx' / '发个任务' / '发布到m-team', OR (2) user wants to delegate a multi-step task to other agents, OR (3) user asks another agent to do something that requires context from a third party (e.g. '在飞书发条消息体现Manager的风格'). This skill transforms a vague request into a structured task and publishes it to the pool."
license: MIT
---

# M-Team Publisher Playbook

## Overview

Publisher 收到用户请求后，将模糊需求转化为结构化任务并发布到 M-Team 任务池。核心职责：**拆解 goal/description/input，填充 PUBLISH CHECKLIST，通过 mteam_publish_task 发布**。

发布后不跟踪，由 executor 通过 heartbeat 认领并执行，完成后自动通知。

## When to Use

**Trigger when user says:**
- "帮我做xxx" / "发个任务" / "发布到m-team" / "交给别人做"
- "这个任务太麻烦了，帮我分发一下"
- "你帮我去飞书发一条" / "发到群里"
- 任何要求另一个 agent 执行而 executor 没有人设上下文才能理解的任务

**Do NOT use when:**
- User wants you to do it yourself
- Task is a single-step question (no meaningful subtask decomposition)
- User explicitly says "你自己做"

## Decision Tree

```
User wants to offload a task
    ↓
This skill activates
    ↓
Step 1: Extract goal / input / description
    ↓
Step 2: Run PUBLISH CHECKLIST — all items must pass
    ↓
Step 3: mteam_publish_task({ description, goal, input, publisher, priority })
    ↓
Step 4: Done. Exit. No tracking.
```

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

**描述结构模板（4个要素）：**

```
{动作} {目标}，筛选 {条件}，{数量逻辑}
```

| 要素 | 写法 | 示例 |
|------|------|------|
| 动作 | 动词开头，表明操作类型 | 搜索、筛选、抓取、生成、提取 |
| 目标 | 要操作的对象 | 宠物玩具、商品详情页、图片 |
| 条件 | 明确的过滤维度 | costPrice ≤ 5 RMB、规格数 ≤ 8 |
| 数量逻辑 | **"找够 N 个"**（数量不足时继续扩大搜索），禁止"前 N 个" | 找够 5 个、找够 10 个 |

**数量逻辑的正反示例：**

| ❌ 错误（歧义） | ✅ 正确（无歧义） |
|---------------|-----------------|
| 取前 5 个符合条件商品 | 找够 5 个符合条件的商品 |
| 取 top 5 中符合条件的 3 个 | 找够 3 个符合条件的商品 |
| 搜索结果前 10 个里挑 2 个 | 找够 2 个符合条件的商品（不够就继续翻页） |
| 只取搜索结果前 3 页 | 找够 3 个（数量不够就扩大范围直到找到为止） |

**坏味道关键词（出现即预警）：**
- "前 N 个" / "top N" / "取前" → 暗示有限范围，executor 会提前停
- "先做 N 个看看" → executor 可能只做 N 个就 complete
- "够了就行" → executor 不知道什么算够

**好味道关键词（鼓励使用）：**
- "找够 N 个" / "至少 N 个" → 数量达标前持续搜索
- "数量不够时继续扩大搜索范围" → 明确告知重试策略

**简单动作也要写清任务性质：**
- 简单动作（测试 relay 链、确认可达性、记录状态等）同样需要让 executor 知道任务性质
- 格式：`{任务性质前缀}：{具体动作}`
- ✅ "relay 链测试第一步：回复'收到'并将任务 relay 给下一位"
- ✅ "系统可达性检查：回复'收到'确认在线"
- ❌ "回复'收到'"（看不出是什么任务）

**Goal vs Description 示例：**

```
goal: "为 Shopee 马来西亚站点从 1688 选 5 个宠物玩具，costPrice < 5 RMB，规格数 ≤ 8 个，
      完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
      图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/"
description: "搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个"
```

## Step 2: PUBLISH CHECKLIST

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
| 9 | 数量逻辑无歧义 | "取 N 个"必须写清是"**找够** N 个"还是"**从已有结果中取**前 N 个"。若是前者，executor 数量不够时应继续扩大搜索；若是后者，必须明确说明限制条件。避免"前 N 个"、"top N"等模糊措辞？ |

**常见错误对应的检查项：**

| 错误 | 未通过的检查项 |
|------|--------------|
| goal = "Agent 自我介绍任务：体现 Manager 风格" | #1, #2 |
| description = "在飞书发一条自我介绍"（无上下文） | #2, #5 |
| description = goal（两者完全相同） | #4 |
| 任务一步就能完成但发到了池子 | #6 |

## Step 3: Publish

```javascript
mteam_publish_task({
  description: "搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个",
  goal: "为 Shopee 马来西亚站点从 1688 选 5 个宠物玩具，costPrice ≤ 5 RMB，规格数 ≤ 8 个，
        完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
        图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/",
  input: { keyword: "宠物玩具", maxCostPriceRmb: 5, maxSpecs: 8, quantity: 5, platform: "shopee_malaysia" },
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

## Common Pitfalls

| Wrong | Correct |
|-------|---------|
| goal = "Agent 自我介绍任务：体现 Manager 风格" | goal = "发送一条300字以内的自我介绍" |
| goal = "收到任务的 agent 完成自我介绍" | goal = 具体可验证的结果描述 |
| description = "发到飞书群" / "发 Discord" | description = "发送消息"（executor 自己决定渠道） |
| description = goal | description 写第一步，goal 写任务终点 |
| description = "输出到 /tmp/result.json" | description = "抓取页面数据"（executor 自己决定输出到任务文件夹） |
| description = "取前 5 个符合条件商品" | description = "找够 5 个符合条件的商品"（数量不够时继续扩大搜索）；或明确写"仅从搜索结果前 5 个中筛选" |
| goal = "帮我调研供应商" | goal = "从1688筛选3家供应商，输出到 {workspaceRoot}/tasks/{taskId}/" |
| Missing input parameters | Always include `{ keyword, count, chat_id, ... }` as needed |
| description 写"取前 N 个"导致 executor 只查 N 个就停 | description 写"找够 N 个"，数量不够时继续扩大搜索 |
| publisher = agentId instead of "user" | Use "user" unless explicitly assigning to specific agent |

## Verification Checklist

```
□ goal 描述的是结果状态，而不是"谁做"或"给谁看"
□ goal 中不出现"Agent xxx 任务"、"体现 xxx 风格/角色"
□ description 是单步动作，不超过 2 句
□ description 与 goal 不同（description 写第一步，goal 写任务终点）
□ input 参数完整，executor 看完可以直接执行
□ 任务需要多步或跨时段执行（单步任务不需要发池子）
□ description 不写输出格式/路径/发送渠道
□ "取 N 个"的数量逻辑无歧义（找够 N 个 vs 取前 N 个）
```
