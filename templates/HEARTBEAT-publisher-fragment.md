## Publisher 心跳模板

> 框架无关通用写法。`mteam_*` 为示例工具名，实际使用时请替换为你的任务池工具。

### 核心原则

- **只发任务，不收集结果，不汇报。**
- 汇报由 Executor 完成后自行汇报给上级（CEO / Manager / Orchestrator）。

### 检查流程

1. 检查是否有新任务要发（读 `SESSION-STATE.md` 或 `heartbeat-state.json` 的 `pendingTasks`）
2. 发到池子：`mteam_publish_task({ goal, description, input, publisher: "manager", priority })`
3. 回复 HEARTBEAT_OK

### 发任务到池子

```javascript
mteam_publish_task({
  goal: "核心目标（不可更改）",
  description: "第一步的描述（包含验收标准）",
  input: { /* 任务参数 */ },
  publisher: "manager",
  priority: "high" | "normal" | "low"
})
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `goal` | 是 | 核心目标，执行过程中不可更改 |
| `description` | 是 | 第一步的描述，告诉 Executor 从哪开始 |
| `input` | 否 | 初始输入数据 |
| `publisher` | 否 | 发布者，默认 `user` |
| `priority` | 否 | 优先级，默认 `normal` |

### description 建议格式

```
## 任务
[第一步要做什么]

## 验收标准
[做成什么样]

## 截止时间
[时间]
```

### 注意

- `goal` 是任务的"不变锚点"，整个执行过程围绕它展开
- `description` 是"第一步"的描述，不是全量步骤说明
- 只发任务，**不**收集结果、不汇报上级
- 汇报由 Executor 完成并自行汇报
- 拿到任务后使用对应的 Publisher skill，按步骤提取 goal / input / description 并验证
