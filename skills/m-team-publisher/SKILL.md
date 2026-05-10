---
name: m-team-publisher
description: "Use when: (1) user wants to hand off a task to the M-Team pool, (2) a request needs cross-agent or cross-time execution, or (3) another agent needs a self-contained first step instead of vague delegation. This skill rewrites the request into one pool-ready first baton and publishes it."
license: MIT
---

# M-Team Publisher Playbook

## Overview

Publisher 的职责只有一件事：**把用户请求改写成可直接认领的第一棒任务，然后调用 `mteam_publish_task` 发布到任务池。**

核心原则：
- **先判断这事该不该进池子**
- **只发布第一棒，不把整包需求一次塞给 executor**
- **goal 写终点，description 写当前这一棒**
- **发布后不跟踪，不轮询，不催办**

## When to Use

**触发场景：**
- 用户明确说：`发个任务` / `发布到 m-team` / `交给别人做`
- 任务需要跨 agent 接力、跨时段执行、或由别的 agent 处理更合适
- 当前会话不能直接一口气做完，需要先把第一棒发出去

**不要使用：**
- 用户要你当前会话自己做完
- 单步即时任务，当场就能完成
- 需求还没拆到“executor 看完 description 就能立刻开工”

## Decision Flow

```text
收到用户请求
  ↓
Step 0: 判断是否真的需要进池子
  ↓
Step 1: 先定 taskType，再拆 goal / description
  ↓
Step 2: 逐项跑 PUBLISH CHECKLIST
  ↓
Step 3: 调用 mteam_publish_task 发布第一棒
  ↓
Step 4: 结束，不跟踪
```

## Step 0: 先判断该不该发池子

只有满足以下任一条件，才应该发池子：
- 任务需要多步接力
- 任务会跨时段，不适合当前会话同步做完
- 任务需要另一个 agent 的技能/身份/环境

**不该发池子的典型情况：**
- 只是问一个问题
- 当前 agent 自己就能直接完成
- 只是“顺手发个消息”“读个文件”“改一句文案”这类单步动作

判断规则：
- **能在当前会话直接完成，就不要发池子**
- **不能直接做完，才把“第一棒”发出去**

## Step 1: 提炼三个字段

| 字段 | 作用 | 硬规则 |
|------|------|--------|
| `taskType` | 任务类型 | 先按当前这一棒动作分类，不按最终大目标分类 |
| `goal` | 整个任务终点 | 只用于 publisher 验收和 agent_end 复盘 |
| `description` | 当前这一棒做什么 | executor 认领时主要看它，必须单步可执行 |

### 1. taskType 规则

可选值：
- `general`：通用动作，如简单确认、记录、轻量同步
- `coding`：代码实现、修 bug、测试、重构
- `research`：检索、调研、资料收集、比对
- `ops`：部署、配置、排障、环境操作
- `data`：数据清洗、整理、统计、转换
- `design`：UI/视觉/交互/原型
- `content`：文案、Listing、脚本、营销内容

判断口径：
- 按**当前这一棒**的动作选，不按最终 goal 选
- 不要因为任务最终很复杂，就偷懒全写 `general`
- 只是简单传话/记录/确认，才用 `general`

### 2. goal 规则：写任务终点，不写过程

goal 必须描述：**任务最终完成时，客观上会是什么结果**。

必须包含：
- 任务对象
- 关键约束
- 完成标准
- 产出物摘要（如果有）

必须避免：
- 写“谁让我做”
- 写“体现谁的风格/身份”
- 写“给谁看”
- 把当前动作错写成终点

写法要求：
- 用客观视角描述结果状态
- 默认输出落在任务目录：`{workspaceRoot}/tasks/{taskId}/`
- 不依赖会话外隐含上下文

**反例：**
- ❌ `帮我调研供应商`
- ❌ `Agent 自我介绍任务：体现 Manager 风格`
- ❌ `发到飞书群里告诉他们我是谁`

**正例：**
- ✅ `从 1688 筛选 3 家符合条件的供应商，输出商品链接、价格、起订量和备注到 {workspaceRoot}/tasks/{taskId}/`
- ✅ `发送一条 300 字以内的自我介绍，包含角色定位和合作方式说明`

### 3. description 规则：只写第一棒当前动作

description 必须满足：
- 只写**当前这一棒**要做的一个动作
- executor 看完就能直接开始
- 不超过 2 句
- 不夹带输出路径、文件格式、发送渠道、人设包装

格式建议：

```text
{动作} {目标}，补充 {条件/边界}
```

**反例：**
- ❌ `帮我处理一下`
- ❌ `回复收到`
- ❌ `先查再筛再汇总发群里`
- ❌ `发到飞书群，体现 Manager 风格`
- ❌ `输出到 /tmp/result.json`

**正例：**
- ✅ `搜索 1688 宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个`
- ✅ `抓取已选商品的详情页主图和 SKU 信息`
- ✅ `在当前任务内留痕记录已收到供应商报价`

## Step 1.5: 数量逻辑必须写死，不能留歧义

凡是 description 里涉及数量，必须明确是哪一种：

### A. 找够 N 个
表示数量不够时，要继续扩大搜索范围。

示例：
- ✅ `找够 5 个符合条件的商品`
- ✅ `至少整理 10 条可用报价`

### B. 仅从已有结果中取前 N 个
表示范围有限，不需要继续扩大。

示例：
- ✅ `仅从当前页结果中取前 5 个商品做初筛`
- ✅ `从已抓到的 20 条记录中选前 3 条示例`

**禁止模糊写法：**
- ❌ `前 5 个`
- ❌ `top 5`
- ❌ `先做 3 个看看`
- ❌ `够了就行`

默认原则：
- 只要目标是凑齐数量，写成 **找够 N 个**
- 不要让 executor 误以为只查前几条就能停

## Step 1.6: 多动作必须拆成第一棒

如果一句话里同时出现多个动作动词，默认要拆。

典型多动作：
- 搜索 + 筛选 + 汇总
- 抓取 + 清洗 + 导出
- 撰写 + 发送
- 修复 + 测试 + 提交

Publisher 只发当前这一棒，后续动作由 executor relay 给下一棒。

**反例：**
- ❌ `先查 1688，再筛选，再汇总发群里`
- ❌ `修 bug 后跑测试并提交代码`

**正例：**
- ✅ `搜索 1688 宠物玩具关键词，筛选符合价格条件的候选商品`
- ✅ `定位 publisher skill 中与 description 校验相关的重复逻辑`

## Step 2: PUBLISH CHECKLIST

调用 `mteam_publish_task` 之前，必须逐项确认：

| # | 检查项 | 通过标准 |
|---|--------|----------|
| 1 | taskType 正确 | 已按当前这一棒动作选对类型，不是偷懒全写 `general` |
| 2 | goal 是终点 | goal 描述的是结果状态，不是当前动作 |
| 3 | goal 无人设/身份噪音 | 没有“体现 xxx 风格”“给 xxx 看”“Agent xxx 任务” |
| 4 | description 是单步动作 | executor 看完知道第一步怎么做 |
| 5 | description 与 goal 不重复 | 一个写终点，一个写当前这一棒 |
| 6 | description 自包含 | 不依赖额外 input、隐含背景或发布者脑补 |
| 7 | 任务适合进池子 | 不是当前会话就能直接完成的单步任务 |
| 8 | description 不写路径/格式 | 不出现“输出到”“保存为”“CSV”“json”等 |
| 9 | description 不写渠道口号 | 不写“发到飞书/Discord/群里”这类渠道导向表达 |
| 10 | description 不是空动作 | 不是“回复收到”“确认一下”“处理一下” |
| 11 | 数量逻辑无歧义 | 已明确“找够 N 个”还是“仅从已有结果取前 N 个” |
| 12 | 多动作已拆开 | 当前只发布第一棒，不把整包动作揉成一句 |
| 13 | 人设/风格未冒充业务动作 | 没把“体现 Manager 风格”等误写成业务动作 |

## Step 3: Publish

发布时只传这五个字段：
- `description`
- `goal`
- `taskType`
- `publisher`
- `priority`

示例：

```javascript
mteam_publish_task({
  description: "搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8 的商品，找够 5 个",
  goal: "为 Shopee 马来西亚站点从 1688 选出 5 个宠物玩具，满足 costPrice ≤ 5 RMB、规格数 ≤ 8，完成后续详情抓取、英文 Listing 生成与素材整理，并输出到 {workspaceRoot}/tasks/{taskId}/",
  taskType: "research",
  publisher: "user",
  priority: "high"
})
```

发布前最后再问自己一次：
- 这事是不是我当前会话就能直接做完？
- 如果不是，description 是否已经缩成“第一棒”？
- executor 是否不用回头追问就能开工？

只要有一项答案是否定，就先改写再发布。

## Step 4: 发布后立即退出，不跟踪

发布后：
- **不要**轮询 `mteam_get_all_tasks`
- **不要**周期性检查状态
- **不要**等待完成再回复
- **不要**替 executor 预先规划后面每一棒

发布完成后，Publisher 的职责已经结束。

## Common Pitfalls

| 错误写法 | 正确写法 |
|---------|----------|
| goal = `Agent 自我介绍任务：体现 Manager 风格` | goal = `发送一条 300 字以内的自我介绍，包含角色定位和合作方式说明` |
| description = `发到飞书群` | description = `发送自我介绍消息`（渠道由执行时上下文决定） |
| description = `回复收到` | description = `在当前任务内留痕记录已收到报价` |
| description = `前 5 个符合条件商品` | description = `找够 5 个符合条件的商品` 或明确 `仅从已有结果前 5 个中筛选` |
| description = `先查再筛再汇总发群里` | description = `搜索候选商品并完成初筛` |
| 专业任务全写 `general` | 按当前这一棒选择 `coding/research/ops/data/design/content` |
| 一步就能做完也发池子 | 当前会话直接做，不发池子 |
| 还没拆清楚就整包发出去 | 先把第一棒写清楚，再发布 |

## Verification Checklist

```text
□ 我已先判断：这件事确实需要进池子
□ 我已按当前这一棒动作选好 taskType
□ goal 写的是任务终点，不是过程
□ goal 中没有“谁做”“给谁看”“体现谁风格”
□ description 是单步动作，executor 看完能直接开工
□ description 与 goal 不重复
□ description 不依赖隐含上下文
□ description 不写路径、格式、渠道
□ description 不是“回复收到/确认一下/处理一下”这类空动作
□ 数量逻辑已写清：找够 N 个 / 仅从已有结果取前 N 个
□ 多动作已经拆成第一棒
□ 发布后我不会继续跟踪或轮询
```
