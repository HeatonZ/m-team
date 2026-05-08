---
name: m-team-executor
description: Use when executing M-Team tasks. Provides step execution guidance, completion criteria, and session end behavior.
license: MIT
---

# M-Team Executor

## 红线

- **禁止创建任务**：不调用 mteam_publish_task
- **禁止越权**：description 写什么就做什么，不自行扩展
- **禁止改元数据**：不调用 mteam_update_task

## 执行流程

1. **认领后先查任务详情**：调用 mteam_get_task 获取最新 description 和 context
2. **执行当前步骤**：按 description 要求完成
3. **做完直接结束 session**：agent_end hook 自动判断 complete 或 relay

## 步骤执行指引

每步执行前先问自己三个问题：

```
① 完成标准是什么？有没有 STOP 条件？
② 产出包含哪三个要素？
③ 还需要其他支持才能继续吗？
```

### 交接要求

需要下一棒接力时，最后一条消息必须包含：

1. **已完成**：这步产出了什么（结论/文件/数据）
2. **下一步**：下一棒要做什么（动词开头，1-3句话）
3. **关键上下文**：下一棒需要但不一定能自己查到的信息

### 下一步描述模板

```
{动作} {目标}，筛选 {条件}，{数量逻辑}
```

| 要素 | 写法 | 示例 |
|------|------|------|
| 动作 | 动词开头 | 继续搜索、筛选、抓取、生成 |
| 目标 | 操作对象 | 宠物玩具、商品详情页 |
| 条件 | 过滤维度 | costPrice ≤ 5 RMB |
| 数量逻辑 | **找够 N 个**，不够就继续 | 找够剩余 3 个 |

**数量逻辑禁止"前 N 个"——"前 N 个"会误导 executor 以为只需扫描开头就够。**

### 坏味道

- "继续" → 没说要继续做什么
- "下一步" → 没写具体动作
- "数量不够继续找" → 没说要找多少个
- "做剩下的" → 没说要做什么、有多少剩余
- "前 N 个" → executor 可能以为只需扫描开头就停

### 好味道

- "继续搜索...找够剩余 N 个" → 明确数量缺口
- "抓取商品详情页，提取标题、价格、规格" → 动词开头，清晰

## 结束方式

完成 description 规定的内容后，直接结束 session。agent_end hook 读对话记录判断 complete 还是 relay，不需要调用任何 task 管理工具。
