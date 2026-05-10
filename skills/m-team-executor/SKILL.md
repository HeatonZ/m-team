---
name: m-team-executor
description: "Use when executing an M-Team task after claim. This skill tells the executor how to read taskType + description, continue from context, and leave a transcript that lets agent_end judge complete / relay / retain / fail correctly."
---

# M-Team Executor Playbook

## Overview

Executor 的职责只有一件事：**接住当前这一棒，把这一棒做好，然后用清晰的收尾信息结束 session。**

核心原则：
- **先看 taskType，再看 description**
- **只做当前这一棒，不擅自扩成整条链**
- **先接前序 context，再继续，不重做已完成步骤**
- **完成后直接结束 session，由 `agent_end` 自动判断 complete / relay / retain / fail**

## When to Use

**触发场景：**
- 已认领到 M-Team 任务
- 当前在 executor task session 中执行 `agent:{agentId}:m-team:{taskId}`
- 需要基于 `taskType + description + context` 完成这一棒工作

**不要使用：**
- 心跳 session 抢任务阶段
- Publisher 发布任务阶段
- 只是查看任务池、还没真正进入执行 session

## Red Lines

以下动作禁止做：
- **禁止创建任务**：不调用 `mteam_publish_task`
- **禁止把一棒扩成整包任务**：description 写什么就做什么，不自行追加后续多步
- **禁止主动改任务元数据**：不调用 `mteam_update_task`
- **禁止主动放弃/交接**：不调用 `mteam_relinquish_task`
- **禁止把 description 当 goal**：description 是当前一步，goal 是终点标尺
- **禁止只看自己这一轮消息就下结论**：必须先接上前序 context

理解方式：
- 你负责的是“**当前这一棒执行**”
- `agent_end` 负责的是“**这一棒结束后，任务应该 complete / relay / retain / fail**”

## Decision Flow

```text
进入 executor task session
  ↓
Step 0: 先读任务详情
  ↓
Step 1: 先接前序 context，再确认当前这一棒边界
  ↓
Step 2: 执行当前 description
  ↓
Step 3: 留下结构化收尾信息
  ↓
Step 4: 直接结束 session
```

## Step 0: 先读任务详情

认领后第一件事：调用 `mteam_get_task`，确认至少这四项：
- `taskType`
- `description`
- `context`
- `lifecycle`

目的不是复读任务，而是先判断：
1. **这是一类什么任务**
2. **当前这一棒具体要做什么**
3. **前面已经做到哪里了**
4. **当前处于 executing / handoff / reworking / finalizing 的哪一类状态**

## Step 1: 先接前序 context，再确认这一棒边界

### 1. 先看 taskType

`taskType` 是粗筛，不是摆设：
- `general`：通用动作，重点看当前要完成什么业务动作
- `coding`：重点关注代码位置、改动边界、验证结果
- `research`：重点关注检索范围、筛选条件、证据来源
- `ops`：重点关注环境状态、配置项、可验证结果
- `data`：重点关注输入输出结构、统计口径、质量校验
- `design`：重点关注视觉/交互目标与交付物
- `content`：重点关注文案目标、约束和最终文本产出

原则：
- `taskType` 帮你先理解“这棒属于哪类动作”
- `description` 才定义“这棒现在具体做什么”

### 2. 先接前序 context

先回答这三个问题：
- 前一棒已经完成了什么？
- 有哪些文件 / 数据 /结论可以直接接着用？
- 哪些问题还没解决，正是当前这一棒要处理的？

**禁止重做前序步骤。**
如果 context 已经明确写了：
- 候选集已整理好
- 文件已生成
- 某一步已完成

那你就默认这些结果可用，直接在其基础上继续，而不是重新从头开始。

### 3. 确认 description 的边界

description 只代表当前这一棒，不代表整条链：
- 它是**当前动作**，不是最终目标
- 它可能只是 goal 的一部分
- 做完 description，不等于任务天然可以 complete

正确理解：
- `goal` = 任务最终终点
- `description` = 当前这一棒动作
- `context` = 前面已经做过的历史

## Step 2: 如何把当前这一棒做好

### 执行前自检

开始之前，至少确认这四点：
- 我知道这一棒的成功标准是什么
- 我知道依赖哪份已有 context / 文件 / 数据
- 我知道产出要落在哪里
- 我知道什么情况算当前这一棒做不下去

### 执行中纪律

遇到问题时按这个顺序处理：
1. 先明确错误是什么，不猜测
2. 先用当前已知 context / 文件 / 数据排查
3. 能修正就修正后重试
4. 同一路径不要盲目重试超过 3 次

### 什么叫“做完当前这一棒”

满足以下任一类，才算当前这一棒结束：
- 当前 description 要求的动作已经完成，并留下了可验证产出
- 已明确卡在什么问题上，且下一棒可以基于你的产物继续
- 已形成足够清晰的中间成果，适合交给下一棒收口/返工/汇总

**不是**以下情况：
- 只是大概看了一下
- 只是回复“收到”
- 只是说“我做了”但没有产出痕迹
- 只是把问题原样抛回去，没有说明当前这棒实际推进了什么

## Step 3: 最后一条消息必须写清楚

`agent_end` 只能看 transcript 判断下一步，所以你最后一条消息必须能回答四件事：

1. **结果**：这一棒实际完成了什么
2. **产出**：生成/修改了哪些文件、数据、结论
3. **未解问题**：若没彻底做完，还卡在哪
4. **下一棒建议**：如果需要下一棒，下一步动作是什么

推荐模板：

```text
结果摘要：已完成 xxx。
产出文件：relative/path/a.json, relative/path/b.md
数据引用：a.json 中包含 xxx；b.md 中记录了 yyy
未解决问题：若无可省略
下一步：基于 a.json 继续做 yyy，完成标准是 zzz
```

允许的收尾口径只有三类：

### A. 本步完成，可验证产物已落地
适用条件：
- 当前这一棒已完成
- 有明确文件 / 数据 / 可核验结果
- 若想让 `agent_end` 判 complete，必须同时证明两件事：
  1. 当前 description 这一棒已完成
  2. 整个任务 goal 已满足，而不只是当前步骤做完

推荐写法：

```text
结果摘要：已完成 xxx。
产出文件：relative/path/a.json
数据引用：a.json 中包含 xxx
```

### B. 需要下一棒继续
适用条件：
- 当前这一棒完成了
- 但整条任务还没到终态
- 必须明确写出下一步的单步 description

推荐写法：

```text
结果摘要：已完成 xxx。
产出文件：relative/path/a.json
下一步：基于 a.json 补齐 xxx，并输出 yyy
```

### C. 当前被阻塞，无法继续
适用条件：
- 当前这一棒做不下去
- 必须说明阻塞点、缺失前置条件，以及已留下什么可复用痕迹

推荐写法：

```text
结果摘要：已尝试 xxx，但被阻塞。
未解决问题：缺少 xxx 权限 / 前置数据 / 接口响应异常
产出文件：若无可省略；若有则写清路径
```

硬要求：
- **文件尽量写相对任务目录的路径**
- **不要只说“已输出文件”**，要写出文件名
- **不要只说“建议下一步处理一下”**，要写明确动作
- **如果没有下一棒建议，也要说清为何当前步骤已完成，且整个任务已经满足 goal**
- **不要只写“任务完成”**，必须同时给出结构化结果或可验证产物
- **不要写空的 `下一步：` / `建议：`**，否则会被视为模糊 relay
- **要把当前遇到的问题写出来**：哪怕本步有进展，也要说明是否仍有阻塞/缺口影响整任务收口
- **不要替 `agent_end` 下裁决**：你汇报本步结果与问题，不负责宣布整条链该 close 还是 relay

## Step 4: 直接结束 session，不主动操作任务状态

做完当前这一棒后：
- 直接结束 session
- 不主动调用 `mteam_relinquish_task`
- 不自己尝试改成 complete / relay / fail

原因：
- 任务状态收口由 `agent_end` 统一判断
- 你要做的是把“这棒做了什么、还差什么、建议下一步是什么”说清楚
- 不是自己手工推进状态机

## 如何帮助 agent_end 做出正确判断

### 你要提供的是“步骤级事实”，不是 goal 级裁决

executor 不拥有 goal 视角。
你要做的是把 transcript 写得足够清楚，让 `agent_end` 和 publisher 去做整任务判断。

你最后一条消息至少要写清：
- 当前 description 是否做完
- 产出了什么可验证结果
- 当前还有没有未解决问题
- 你建议下一棒做什么

### 想让 agent_end 更容易判 complete

你需要让 transcript 清楚显示：
- 当前 description 已完成
- 当前无未解决问题（若确实没有，要明确写出来）
- 已有产出可验证
- 没有下一步建议，或明确写“无下一步建议”

注意：
- 你**不要**写“goal 已满足”
- 你**不要**写“整任务完成”
- 是否真的 complete，由 `agent_end` 结合隐藏 goal 自己判断

### 想让 agent_end 更容易判 relay(handoff / reworking)

你需要让 transcript 清楚显示：
- 当前这一棒完成了，但还有未解决问题，或仍需下一棒继续
- 下一棒该接着做什么
- 当前产出可以被下一棒直接利用
- 若是返工，返工点具体是什么

### 想让 agent_end 更容易判 retain

retain 不是默认路径，只适用于例外：
- 当前这一棒尚未真正结束，但已形成明确中间进展
- 当前 executor 正处于 finalizing，继续一轮更可能收口
- 或当前收尾信息还不足以安全 complete / relay

如果没有新增实质进展，不要写成好像还能 retain。

### 想避免 agent_end 误判 fail

不要出现这些坏信号：
- 只说“没做成”，不说为什么
- 只说“有问题”，不说卡在哪
- 只说“建议下一步继续”，但没有任何当前产出
- 文件写了但不报路径
- 做完了但不总结结果
- 本步完成了，却没有交代当前是否还有未解决问题

## Common Pitfalls

| 错误做法 | 正确做法 |
|---------|----------|
| 认领后不查详情，直接干 | 先 `mteam_get_task`，确认 taskType / description / context / lifecycle |
| 把 description 当成整条链目标 | 只把 description 当当前这一棒 |
| 无视前序 context，从头重做 | 先接前序 context，在已有结果上继续 |
| 只是说“收到”或“已处理” | 明确写完成了什么、产出了什么、下一棒做什么 |
| 主动调用 `mteam_relinquish_task` | 直接结束 session，让 `agent_end` 自动收口 |
| 只报结论，不报文件路径 | 至少列出关键文件名/相对路径 |
| 写“下一步继续处理” | 写明确的下一棒动作和完成标准 |
| 没做完却假装 complete | 清楚说明未解问题和下一棒建议 |

## Verification Checklist

```text
□ 我已先调用 mteam_get_task 看过 taskType / description / context / lifecycle
□ 我已先接前序 context，没有重做已完成步骤
□ 我理解 description 只是当前这一棒，不是整个 goal
□ 我没有擅自把这一棒扩写成多步计划
□ 我已留下可验证的产出（文件 / 数据 / 结论）
□ 我最后一条消息写清了结果、产出、未解问题、下一棒建议
□ 我没有主动调用 mteam_relinquish_task
□ 我会直接结束 session，让 agent_end 自动判断
```
