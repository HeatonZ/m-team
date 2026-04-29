# HEARTBEAT 追加内容 — Manager Agent（m-team）

> 将此内容追加到 `~/.openclaw/workspace-manager/HEARTBEAT.md` 末尾。
> 不要替换原有内容，只追加。

## m-team Publisher 循环（Manager 专用）

> **只发任务，不收集结果，不汇报。**
> 汇报由 Executor 完成后自行汇报给 CEO。

### 检查流程

1. 检查是否有 CEO 新任务要发（读 `SESSION-STATE.md` 或 `heartbeat-state.json` 的 `pendingTasks`）
2. 发到池子：`mteam_publish_task({ description, input, publisher: "manager", priority })`
3. 回复 HEARTBEAT_OK

### 发任务到池子

```javascript
mteam_publish_task({
  description: "任务描述（包含验收标准）",
  input: { /* 任务参数 */ },
  publisher: "manager",
  priority: "high" | "normal" | "low"
})
```

### 注意

- 只发任务，**不**收集结果、不汇报 CEO
- 汇报由 Executor 完成并自行汇报
- description 格式建议：

```
## 任务
[任务目标]

## 验收标准
[做成什么样]

## 截止时间
[时间]
```

### 拿到任务后

使用 `m-team-publisher` skill：发布任务前，按 skill 中的步骤提取 goal / input / description 并验证。
