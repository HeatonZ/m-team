---
name: m-team-publisher
description: M-Team 任务发布技能——当用户需要发布任务到去中心化任务池时触发。分析需求→拆解goal/description→发布。
triggers:
  - 发布任务
  - 发个任务
  - 发任务
  - 把这个交给别人做
  - 发布到m-team
  - mteam_publish_task
---

# M-Team 任务发布

## What

将用户需求转化为 M-Team 任务池中的可执行任务。

## When

- 用户要求"帮我做xxx"
- 用户说"发布任务"
- 用户想把任务派发给其他 agent

## Step 1：分析需求

确认三件事：

1. **Goal（目标）** — 不可更改的最终状态，用户要什么
2. **Input（输入）** — 执行需要什么参数（关键词、数量、文件等）
3. **第一步描述** — 现在立刻要做什么

```
Goal：找到收纳箱类目下评分高的1688供应商并报价
Input：{ keyword: "收纳箱", count: 10 }
第一步：搜索1688供应商，输出列表
```

## Step 2：区分 Goal 和 Description

| 字段 | 含义 | 规则 |
|------|------|------|
| `goal` | 最终目标 | 不可拆分、不可更改 |
| `description` | **当前这一步**要做什么 | 下一个 executor 看到能直接执行 |

**错误示范：**
- goal 写"搜索+联系+报价" → 太长，不是单一目标
- description 写"完成供应商调研" → 太模糊

**正确示范：**
- goal = "找到收纳箱类目Top10供应商报价单"
- description = "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接"

## Step 3：发布

```javascript
mteam_publish_task({
  description: "搜索收纳箱1688供应商，输出名称+评分+主营产品+链接",
  goal: "找到收纳箱类目Top10供应商报价单",
  input: { keyword: "收纳箱", count: 10 },
  publisher: "user"
})
```

## Step 4：不追踪，结束

任务进入 `pending` 池后，Executor 自动认领。完成后系统推送通知，不需要 publisher 蹲守。

## 常见错误

| 症状 | 根因 |
|------|------|
| executor 不知道做什么 | description 太模糊 |
| executor 完成了但goal不对 | goal 定义不准 |
| 任务一直pending没人接 | description 太大，应该再拆 |
