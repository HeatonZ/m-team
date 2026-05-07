---
name: m-team-executor
description: Use when executing M-Team tasks. Covers step execution, context recording, relay handoff, and escalation criteria.
license: MIT
---

# M-Team Executor 执行方法论

## Overview

Executor 执行 M-Team 任务的完整执行框架。核心原则：

1. **认领时只看 description**（做什么），goal 只在复盘时用来判断是否完成。
2. **不需要手动 complete/relay** —— agent_end hook 在 session 结束时自动处理。
3. **边做边写 context** —— 用 mteam_update_task 记录每一步。

适用于所有从 M-Team 任务池执行任务的 agent。

## 红线

- **禁止创建新任务**：不要调用 mteam_publish_task。你不是发布者，不要拆分/裂变/创建子任务。
- **禁止越权**：description 写什么就做什么，不自行扩展范围。
- **禁止跳过记录**：每完成一个步骤必须用 mteam_update_task 记录 context。

## When to Use

- 开始执行前，明确这一步的完成标准
- 执行过程中遇到障碍，需要判断下一步
- 步骤完成，需要交接下一步（更新 description + 记录 context）
- 遇到自己处理不了的情况，需要判断升级还是重试

## 一、步骤执行框架

每一步执行前，明确回答：
- 这一 step 的"完成标准"是什么？
- 产出需要包含哪三个要素？
- 有没有 STOP 条件（遇到就停止，不继续）？

### 做完后的思考

```
① 这个 step 是否已达到 description 要求的目标？
   - 没达到 → 继续做，直到达到
   - 达到了 → 进入②

② 完成这个 step 后，我是否还需要其他支持（工具/信息/权限）才能继续？
   - 需要，且无法自行获取 → 记录 context，更新 description 告诉下一棒缺什么
   - 需要，但可以自行获取 → 自行获取后继续
   - 不需要 → 进入③

③ 任务是否还有后续步骤需要其他人接力？
   - 是 → 用 mteam_update_task 更新 description 为下一步，结束 session
   - 否 → 做完所有事，结束 session
```

**原则：每步只做 description 规定的一件事。不多做，也不少做。**

### 边做边写 Context

每完成一个子步骤，用 mteam_update_task 追加 context：

```
mteam_update_task({
  taskId,
  agentId,
  contextStep: "{动宾短语：做了什么}",
  contextOutput: {
    summary: "{一句话结果}",
    files: ["{产出文件路径}"],
    "{关键字段}": "{值}"
  }
})
```

### 需要交接时

用 mteam_update_task 同时记录 context + 更新 description：

```
mteam_update_task({
  taskId,
  agentId,
  contextStep: "完成 {什么}",
  contextOutput: { summary: "{结果}", next_action: "{下一步：动词开头，1-3句话}" },
  description: "{下一步的具体描述}"
})
```

**contextOutput 必须包含：**
1. **已完成**：这步做了什么（结论/文件/数据）
2. **下一步**：下一棒要做什么（动词开头，1-3句话）
3. **关键上下文**：下一棒需要知道但不一定能自己查到的信息

**不允许的 contextOutput：** 空 `{}`、只有文字分析没有数据、`summary: "进行中"`

## 二、Session 结束（自动判断）

**executor 不需要调用 complete_task 或 relay_task。** agent_end hook 在 session 结束时自动判断：

- **正常结束**（success=true）→ LLM 判断 goal 是否达成，自动 complete 或 relay
- **异常崩溃**（success=false）→ 自动 mark fail

所以 executor 只做两件事：
1. 完成 description 规定的这一步
2. 如果需要交接，用 mteam_update_task 更新 context 和 description
3. 结束 session

## 三、升级判断（必须上报，不可自行决定）

满足**任一**立即升级，写清楚五条：

```
① 原始任务
② 当前状态
③ 卡点原因
④ 已尝试方案（至少两条）
⑤ 我的判断 + 选项A / B / C
```

| 触发条件 | 上报内容 |
|---------|---------|
| 目标无法验证 | 说明无法验证什么 + 已尝试的验证方法 |
| 涉及风险决策 | 具体是什么风险 + 我的判断 |
| 任务本身有问题 | 方向性错误，还是条件不足 |
| 三次失败 | 前两次失败原因 + 本次失败原因 |
| 信息矛盾无法判断 | 矛盾的具体内容 + 各自依据 |

## 四、常见角色职责

```
maker    → 实施类任务（写代码、改配置、跑脚本）
fixer    → 修复类任务（bug 定位、问题排查）
scholar  → 调研类任务（搜索、分析、总结）
captain  → 协调类任务（任务拆分、进度跟踪）
```

**简单动作不受角色限制：**
回复消息、传递信息、状态更新、记录日志 → 所有 agent 都能执行，不要求角色匹配。

## Common Pitfalls

| 症状 | 根因 | 正确做法 |
|------|------|---------|
| relay 后下一棒说"不知道做什么" | description 写得模糊 | description 必须动词开头，边界清晰 |
| Publisher 说不合格 | summary 写了"已完成"但没有数据 | summary 必须包含具体结果（数据/文件/结论） |
| 一直不记录 context | 没做到"边做边写" | 子步骤完成立即 mteam_update_task |
| description 说一步，executor 做了三步 | 没有"做完后的思考"环节 | 每步只做 description 规定的一件事 |
| 做了半截就结束 | 缺少 STOP 条件判断 | 每步执行前先写 STOP 条件 |

## Verification Checklist

```
□ 这一步的完成标准我是否清楚？
□ 每完成一个子步骤是否用 mteam_update_task 记录了 context？
□ contextOutput.summary 是否包含具体结果（不是"进行中"或"已完成"）？
□ 如果需要交接，description 是否已更新为下一步？
□ 是否有 STOP 条件被触发但我没有停止？
□ 涉及风险/方向判断是否已升级？
□ 结束时只需结束 session，不需要手动调 complete/relay
```
