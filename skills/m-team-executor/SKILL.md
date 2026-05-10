---
name: m-team-executor
description: "Use when executing M-Team tasks — 按 taskType + description 执行。提供链式任务执行指引、红线约束和交接写法。"
---

# M-Team Executor

## 红线

- **禁止创建任务**：不调用 `mteam_publish_task`
- **禁止越权扩写**：description 写什么就做什么，不自行扩展成多步计划
- **禁止改元数据**：不调用 `mteam_update_task`
- **禁止主动放弃/交接**：不调用 `mteam_relinquish_task`。完成当前一棒后直接结束 session，由 `agent_end` hook 判断 `relay / complete / retain / fail`

## 执行流程

1. **认领后先查任务详情**：调用 `mteam_get_task` 获取 `taskType`、`description`、`context`、`lifecycle`
2. **先看前序 context，再执行当前一棒**：确认前面已经完成到哪，不重做已完成步骤
3. **只做当前 description**：description 是当前一棒唯一动作，不是整条任务链目标
4. **做完直接结束 session**：不要调用 relinquish / complete / relay 类工具；hook 会自动收口

## 如何执行好当前一棒

### 接受任务时

先确认四点：
- 我知道当前这一棒要达成什么结果
- 我知道依赖哪份前序 context / 文件 / 数据
- 我知道成功产出的样子（文件 / 数据 / 结论）
- 我知道什么情况算失败或需要下一棒返工

### 执行中

遇到错误不要猜测，按顺序处理：
1. 错误信息是什么
2. 我能做什么来修正
3. 修正后重试；同一路径不要盲目重试超过 3 次

### 做完时

在最后一条消息中给出交接信息，供 `agent_end` hook 判断：

1. **结果**：完成了什么
2. **产出**：写了哪些文件 / 数据引用
3. **问题**：若未完成，卡在哪
4. **下一棒建议**：如果需要下一棒，明确写下一步动作

建议格式：

```text
结果摘要：已完成 xxx。
产出文件：/path/a.json, /path/b.md
数据引用：a.json
未解决问题：若无可省略
下一步：基于 a.json 继续做 yyy，完成标准是 zzz
```

**重要**：必须明确列出产出文件路径和内容摘要。hook 只能从对话文本提取信息，不会自动理解你写了什么文件。

## 结束方式

完成 description 规定的内容后，直接结束 session。`agent_end` 会按链式状态机判断：
- `complete`
- `relay(handoff)`
- `relay(reworking)`
- `retain(executing/finalizing)`
- `fail`

### 正确交接方式
1. 执行当前 description
2. 最后一条消息说明：做完了什么、写了什么、下一棒建议做什么
3. 结束 session
4. 等 `agent_end` 自动收口

### retain 的理解
retain 不是默认路径，只是例外：
- 当前一棒尚未真正结束，但已有明确中间进展
- 当前 executor 正在 finalizing 收口

正常链式任务，默认更常见的是 `handoff / reworking`，不是 retain。
