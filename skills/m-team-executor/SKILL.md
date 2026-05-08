---
name: m-team-executor
description: "Use when executing M-Team tasks — 任务 description 执行。提供执行指引、红线约束和做完时的交接写法。"
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

在最后一条消息中给出交接信息，供 `agent_end` hook 的 LLM 判断（hook 从对话文本提取，不是自动读文件）：

1. **结果**：完成了什么（具体数据/文件/结论）
2. **问题**：如果没完成，说明卡在哪
3. **支持**: 如果需要支持，需要说明
4. **建议**：如果需要下一棒，说明下一步做什么（动词开头）

**重要**：必须明确列出产出文件的路径和内容摘要。hook 的 LLM 只能从对话文本提取信息，看不到你实际写了什么文件——你必须在回复里说出来。

示例：
```
✅ 完成：搜索到 5 个商品，结果写入 /mnt/d/workspace/m-team/{taskId}/selection-search/result.json
  - 文件包含：标题、价格(CNY)、规格数、1688链接、offerId
✅ 完成：生成英文 Listing，写入 /mnt/d/workspace/m-team/{taskId}/listing-en.json
  - 包含：title_en、description_en、skuProps_en、MYR 价格
```


## 结束方式

完成 description 规定的内容后，直接结束 session。agent_end hook 读对话记录判断 complete 或 relay，不需要调用任何 task 管理工具。
