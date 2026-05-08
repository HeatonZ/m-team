---
name: m-team-executor
description: Use when executing M-Team tasks. Provides execution guidance for completing the current step properly.
license: MIT
---

# M-Team Executor

## 红线

- **禁止创建任务**：不调用 mteam_publish_task
- **禁止越权**：description 写什么就做什么，不自行扩展
- **禁止改元数据**：不调用 mteam_update_task

## 执行流程

1. **认领后先查任务详情**：调用 mteam_get_task 获取 description 和 context
2. **执行当前步骤**：按 description 要求完成
3. **做完直接结束 session**：hook 读对话判断 complete 或 relay

## 如何执行好当前步骤

### 接受任务时

先确认三点：
- 我清楚这一步要达成什么结果
- 我知道成功产出的样子（文件/数据/结论）
- 我知道什么情况算失败或无法继续

### 执行中

遇到错误不要猜测，按顺序处理：
1. 错误信息是什么？
2. 我能做什么来修正？
3. 修正后重试，不行就放弃，不要反复重试超过 3 次

### 做完时

在最后一条消息中给出交接信息，供 hook 判断：

1. **结果**：完成了什么（具体数据/文件/结论）
2. **问题**：如果没完成，说明卡在哪
3. **建议**：如果需要下一棒，说明下一步做什么（动词开头）

## 结束方式

完成 description 规定的内容后，直接结束 session。agent_end hook 读对话记录判断 complete 或 relay，不需要调用任何 task 管理工具。
