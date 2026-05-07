---
name: m-team-executor
description: Use when executing M-Team tasks. Covers step execution (read description only), complete vs relay判断, handover protocol, and escalation criteria.
license: MIT
---

# M-Team Executor 执行方法论

## Overview

Executor执行 M-Team 任务的完整执行框架。核心原则：**认领时只看 description（做什么），goal 只在复盘时用来判断是否完成**。

适用于所有从 M-Team 任务池执行任务的 agent。

## 红线

- **禁止创建新任务**：不要调用 mteam_publish_task。你不是发布者，不要拆分/裂变/创建子任务。
- **禁止越权**：description 写什么就做什么，不自行扩展范围。
- **禁止跳过 relay**：做完一步后有后续步骤 → relay，不要自己做下一棒的事。

## When to Use

- 开始执行前，明确这一步的完成标准
- 执行过程中遇到障碍，需要判断下一步
- 步骤完成，需要判断该 complete 还是 relay
- 任务完成后写 contextOutput
- 遇到自己处理不了的情况，需要判断升级还是重试

## 一、步骤执行框架

每一步执行前，明确回答：
- 这一 step 的"完成标准"是什么？
- 产出需要包含哪三个要素？
- 有没有 STOP 条件（遇到就停止，不继续）？

### 做完后的思考（step 完成 → 判断下一步之间）

```
① 这个 step 是否已达到 description 要求的目标？
   - 没达到 → 继续做，直到达到
   - 达到了 → 进入②

② 完成这个 step 后，我是否还需要其他支持（工具/信息/权限）才能继续？
   - 需要，且无法自行获取 → relay，写清楚缺少什么
   - 需要，但可以自行获取 → 自行获取后继续
   - 不需要 → 进入③

③ 任务是否还有后续步骤需要其他人接力？
   - 是 → relay（不要自己做下一棒的事）
   - 否 → 继续做或 complete
```

**原则：每步只做 description 规定的一件事。不多做，也不少做。**

### 边做边写 Context

每完成一个子动作，立即追加一条 context step：

```json
{
  "type": "step",
  "executor": "{agentId}",
  "step": "{动宾短语：做了什么}",
  "output": {
    "summary": "{一句话结果}",
    "files": ["{可选：产出文件路径}"],
    "{其他关键字段}": "{值}"
  },
  "completedAt": {timestamp}
}
```

contextOutput 参数格式：
- `summary`（必须）：一句话说明这步做了什么 + 结果
- `files`（如有）：本次产出的文件路径列表
- `next_action`（如需交接）：告诉下一棒要做什么

**不允许的 contextOutput：** 空 `{}`、只有文字分析没有数据、`summary: "进行中"`

## 三、完成判断（complete / relay / fail）

```
执行完成 or 认为完成
    │
    ├─► goal 是否已达成？
    │     ├─ 明确达成 → 进入"交接思考"
    │     ├─ 不确定 → 问自己：有没有办法验证？
    │     │       ├─ 能验证 → 验证后再判断
    │     │       └─ 不能验证 → 升级，写清楚"无法验证目标是否达成"
    │     └─ 没有达成 → 继续做或判断 relay
    │
    ├─► [交接思考] 任务是否需要下一步（需要不同角色或不同能力）？
    │     ├─ 是 → relay（不要自己强行做别人的部分）
    │     └─ 否 → 自己继续做或升级
    │
    ├─► 是否遇到技术障碍且无法自行解决？
    │     ├─ 是 → relay 回池子，写清楚障碍
    │     └─ 否 → 自己解决或升级
    │
    └─► 是否超过自己权限或涉及风险决策？
          ├─ 是 → 升级
          └─ 否 → 自己决定
```

### 只有满足以下条件之一才 complete：
1. goal 明确全部达成
2. 这步就是最后一步，且没有后续步骤

**其他情况一律 relay，不 complete。**

### relay 标准动作

调用 `mteam_relay_task`：

```
contextStep = "交接给 {nextRole}：{具体下一步做什么}"
contextOutput = {
  "summary": "{这步完成的内容摘要}",
  "relay_to": "{nextRole}",
  "next_action": "{具体下一步：动词开头，边界清晰}",
  "handoff_context": "{下一棒需要知道的关键信息}"
}
```

**常见误区：executor 做完就 complete，然后等 publisher 安排下一步。** 这是错的——下一步由 executor 判断，不是 publisher。

### failTask 标准动作

调用 `mteam_failTask`：

```
contextStep = "任务失败：{原因}"
contextOutput = {
  "error": "{错误信息}",
  "failed_at": "{失败发生在哪一步}",
  "尝试过的方案": ["{方案1}", "{方案2}"]
}
```

## 四、升级判断（必须上报，不可自行决定）

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

## 五、常见角色职责

```
maker    → 实施类任务（写代码、改配置、跑脚本）
fixer    → 修复类任务（bug 定位、问题排查）
scholar  → 调研类任务（搜索、分析、总结）
captain  → 协调类任务（任务拆分、进度跟踪）
```

**简单动作不受角色限制：**
回复消息、传递信息、状态更新、记录日志 → 所有 agent 都能执行，不要求角色匹配。

relay 时 contextOutput 必须包含：
1. **已完成**：这步做了什么（结论/文件/数据）
2. **下一步**：下一棒要做什么（动词开头，1-3句话）
3. **关键上下文**：下一棒需要知道但不一定能自己查到的信息

## Common Pitfalls

| 症状 | 根因 | 正确做法 |
|------|------|---------|
| relay 后下一棒说"不知道做什么" | next_action 写得模糊 | next_action 必须动词开头，边界清晰 |
| complete 后 Publisher 说不合格 | summary 写了"已完成"但没有数据 | summary 必须包含具体结果（数据/文件/结论） |
| 一直不 relay 也不 complete | 没有 STOP 条件判断 | 每步执行前先写 STOP 条件 |
| 升级后被说"这个你能自己判断" | 升级边界没搞清楚 | 先走完"能自行解决"的路径再升级 |
| context 只有一条"开始执行" | 没做到"边做边写" | 子动作完成立即追加 context step |
| description 说一步，executor 做了三步 | 没有"做完后的思考"环节 | 每步只做 description 规定的一件事 |
| description 说一步，executor 只做了一半就 complete | 缺少"交接思考" | relay 前先问"任务是否还有后续步骤" |

## Verification Checklist

```
□ 这一步的完成标准我是否清楚？
□ contextOutput.summary 是否包含具体结果（不是"进行中"或"已完成"）？
□ 如果需要交接，next_action 是否动词开头、边界清晰？
□ 是否有 STOP 条件被触发但我没有停止？
□ 如果要 complete，goal 是否明确达成（不是"差不多"）？
□ 如果要 relay，next_action 是否不超过 3 句话？
□ 涉及风险/方向判断是否已升级？
□ context 是否已追加本步记录？
```
