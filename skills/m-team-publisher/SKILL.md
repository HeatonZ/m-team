---
name: m-team-publisher
description: "Use when: (1) user says '帮我做xxx' / '发个任务' / '发布到m-team', OR (2) user wants to delegate a multi-step task to other agents, OR (3) user asks another agent to do something that requires context from a third party (e.g. '在飞书发条消息体现Manager的风格'). This skill transforms a vague request into a structured task and publishes it to the pool."
license: MIT
---

# M-Team Publisher Playbook

## Overview

Publisher 收到用户请求后，将模糊需求转化为结构化任务并发布到 M-Team 任务池。核心职责：**先判定 taskType，再拆解 goal / description，填充 PUBLISH CHECKLIST，通过 mteam_publish_task 发布**。

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
Step 1: Extract taskType / goal / description
    ↓
Step 2: Run PUBLISH CHECKLIST — all items must pass
    ↓
Step 3: mteam_publish_task({ description, goal, taskType, publisher, priority })
    ↓
Step 4: Done. Exit. No tracking.
```

## Step 1: Extract Three Fields

| Field | Meaning | Rule |
|-------|---------|------|
| `taskType` | 任务类型 | 先做结构化粗分类：`general`=通用动作，`coding/research/ops/data/design/content`=专业任务；供 heartbeat 先按类型粗筛 |
| `goal` | 完整的任务终点描述 | 只用于验收和复盘，不参与 executor 认领决策 |
| `description` | 当前这一步做什么 | 单步可执行，不超过 2 句；executor 认领时只看它 |
**TaskType 填写规范（先判类型，再写文案）：**
- `general`：通用动作，如回复、记录、同步状态、简单文件读写、轻量确认
- `coding`：代码实现、调试、重构、修 bug、写测试
- `research`：检索、调研、资料收集、方案比较
- `ops`：部署、配置、服务排障、环境操作
- `data`：数据清洗、统计、转换、结构化整理
- `design`：UI/视觉/交互/原型设计
- `content`：文案、Listing、脚本、营销内容
- 规则：先看“任务本质属于哪类”，不要按工具名选类型
- 若只是简单传话/记录/确认，默认 `general`
- 若一条任务里混了多种专业动作，按**当前这一棒**的动作定类型，不按最终 goal 定类型

**Goal 填写规范（必须详细）：**
- goal 只描述**任务终点**，用于 publisher 验收和 agent_end 复盘，不用于 executor 认领
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
- 必要执行条件直接写进 description，不再依赖额外 input 字段
- 格式：`动词 + 目标 + 条件/边界`
- **客观视角**：描述"要做什么"，不描述"谁让我做"或"为谁做"
- **禁止语义空动作**：不要只写"回复收到"、"确认一下"、"同步一下"、"处理一下"
- **禁止心智跳步**：description 必须是 executor 看完就能直接开工的当前动作，不能把"发给谁看"、"体现谁风格"、"顺便再做下一步"揉进去
  - ❌ "帮我搜索宠物玩具" / "用户要选品"
  - ❌ "发一条自我介绍消息，体现 Manager 的风格"
  - ❌ "输出到 /tmp/result.json" / "生成 CSV 格式" / "保存为 a.txt"
  - ❌ "发到飞书群" / "发 Discord" / "发送到群里"
  - ❌ "回复收到" / "确认一下" / "同步一下"
  - ✅ "搜索宠物玩具关键词，筛选 costPrice < 5 RMB"
  - ✅ "抓取商品详情页"
  - ✅ "在当前任务内留痕记录已收到供应商报价"

**拒绝发布条件（命中任一条就先改写，不要直接发池子）：**
- description 读完后，executor 仍然不知道第一步该做什么
- description 同时要求"查 + 筛 + 汇总 + 发出"等多动作
- description 只是"回复收到 / 确认一下 / 跟进一下 / 处理一下"
- description 主要在描述渠道、风格、人设，而不是业务动作
- 任务其实一步就能在当前会话直接完成，不需要进池子

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

**新增硬规则：留痕确认 ≠ 外部发消息**
- 如果目的是在任务内部确认“已收到/已看见/已知晓”，必须明确写成：
  - `在当前任务内留痕记录已收到 xxx`
  - `在 task context 中记录已确认 xxx`
- 不要写成：
  - `回复收到`
  - `确认收到`
  - `说一声收到了`
- 因为这类措辞会被 executor 误解为要去外部聊天渠道发消息。

**多动作拆分规则：**
- 如果一句 description 同时包含 2 个以上动作动词（如：搜索 / 筛选 / 汇总 / 发送 / 提交 / 验收），默认应拆分
- Publisher 只发“这一棒”动作，后续通过 relay 交给下一棒
- ❌ "先查 1688，再筛选，再汇总发群里"
- ✅ "搜索 1688 宠物玩具关键词，筛选 costPrice ≤ 5 RMB 的候选商品"

```
goal: "为 Shopee 马来西亚站点从 1688 选 5 个宠物玩具，costPrice < 5 RMB，规格数 ≤ 8 个，
      完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
      图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/"
taskType: "research"
description: "搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个"
```

## Step 2: PUBLISH CHECKLIST

**逐项确认，每一项都必须为"是"才能调用 mteam_publish_task。若任一项为"否"，先修正再发布，不要跳过。**

| # | 检查项 | 自检问题 |
|---|--------|---------|
| 1 | taskType 正确 | 这是 `general` 还是专业类型？若是专业类型，是否选对 `coding/research/ops/data/design/content` 中的一类，而不是默认全写 general？ |
| 2 | goal 自包含 | goal 描述的是**结果状态**（发送了什么、筛选了什么），而不是"谁做"或"给谁看"？ |
| 3 | goal 无执行者身份 | goal 中不出现"Agent xxx 任务"、"体现 xxx 风格/角色"、"给 xxx 看的"？ |
| 4 | description 是单步动作 | description 描述的是**一个具体动作**，不超过 2 句？ |
| 5 | description 与 goal 不重复 | description 写的是"这一步做什么"，goal 写的是"任务终点"，两者不同？ |
| 6 | description 自包含执行条件 | executor 只看 description 就能开始当前这一步，不需要再找额外 input 或回头问发布者？ |
| 7 | 任务适合池子 | 任务是否需要多步或跨时段执行？单步即时完成的任务不需要发池子？ |
| 8 | description 不写输出格式/路径 | description 中不出现文件路径、扩展名、输出格式关键词（"输出到"、"生成 CSV"、"保存为"）？ |
| 9 | description 不写发送渠道 | description 中不出现"发到飞书"、"发Discord"、"发送到群"等渠道关键词；若真要外发，必须把外发动作写成明确业务动作而非渠道口号？ |
| 10 | description 不是语义空动作 | description 不是"回复收到"、"确认一下"、"同步一下"这类空动作，而是实际业务动作？ |
| 11 | 数量逻辑无歧义 | "取 N 个"必须写清是"**找够** N 个"还是"**从已有结果中取**前 N 个"。若是前者，executor 数量不够时应继续扩大搜索；若是后者，必须明确说明限制条件。避免"前 N 个"、"top N"等模糊措辞？ |
| 12 | 多动作已拆分 | 如果 description 同时包含搜索/筛选/汇总/发送/提交等多个动作，是否已经拆成当前这一棒？ |
| 13 | 渠道/人设没有冒充业务动作 | description 没有把"体现 Manager 风格"、"发给群里"、"让对方知道"这类表达冒充成业务动作？ |

**常见错误对应的检查项：**

| 错误 | 未通过的检查项 |
|------|--------------|
| goal = "Agent 自我介绍任务：体现 Manager 风格" | #2, #3 |
| description = "在飞书发一条自我介绍"（无上下文） | #3, #6, #9, #13 |
| description = goal（两者完全相同） | #5 |
| description = "回复收到" | #10 |
| 任务一步就能完成但发到了池子 | #7 |
| description = "先查再筛再汇总发群里" | #12, #13 |
| 把代码修 bug 任务写成 `general` | #1 |

## Step 3: Publish

**发布前最后判断：这件事是否真的该进池子？**
- 若当前会话的 agent 自己就能一口气做完，直接在当前会话做，不发池子
- 若任务还没拆清楚，先拆成第一棒 description，再发布
- 只有当任务需要跨 agent、跨时段、跨技能接力时，才发池子

```javascript
mteam_publish_task({
  description: "搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个",
  goal: "为 Shopee 马来西亚站点从 1688 选 5 个宠物玩具，costPrice ≤ 5 RMB，规格数 ≤ 8 个，
        完成选品详情抓取 + 英文 Listing 生成，输出 title_en/description_en/skuProps_en（含 MYR 价格），
        图片去背景处理，输出到 {workspaceRoot}/tasks/{taskId}/",
  taskType: "research",
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
| description = "回复收到" | description = "在当前任务内留痕记录已收到报价" 或写清真实业务动作 |
| description 写"取前 N 个"导致 executor 只查 N 个就停 | description 写"找够 N 个"，数量不够时继续扩大搜索 |
| coding / research / ops 这类专业任务也一律写成 `general` | 先按当前这一步动作选 taskType；只有简单通用动作才用 `general` |
| publisher = agentId instead of "user" | Use "user" unless explicitly assigning to specific agent |
| 一步就能做完的事也发进池子 | 当前会话直接做，别发池子 |
| 还没拆清楚就把整包需求发出去 | 先写清第一棒 description，再发布 |

## Verification Checklist

```
□ 已先判断 taskType（general / coding / research / ops / data / design / content）
□ goal 描述的是结果状态，而不是"谁做"或"给谁看"
□ goal 中不出现"Agent xxx 任务"、"体现 xxx 风格/角色"
□ description 是单步动作，不超过 2 句
□ description 与 goal 不同（description 写第一步，goal 写任务终点）
□ description 自包含当前这一步所需条件，不依赖额外 input
□ 任务需要多步或跨时段执行（单步任务不需要发池子）
□ description 不写输出格式/路径/发送渠道
□ description 不是"回复收到"/"确认一下"这类语义空动作
□ "取 N 个"的数量逻辑无歧义（找够 N 个 vs 取前 N 个）
□ 多动作句已拆成当前这一棒
□ 渠道/人设/风格没有冒充成业务动作
□ 我已经判断过：这件事不是当前会话就能直接完成的单步任务
```
