---
name: mteam-executor
related_skills:
  - task-delegation  （通用委托方法论，本 skill 是其在 M-Team 任务池的具体适配）
  - escalation-decisions  （通用升级判断框架）
description: M-Team 多步骤任务执行方法论——executor 拿到任务后的决策框架、步骤交接协议、升级边界。反模式+检查清单，不教代码。
triggers:
  - mteam executor 拿到任务后怎么做
  - 多步骤任务怎么判断该 complete 还是 relay
  - executor 什么时候升级什么时候自己做
  - mteam relay 协议
---

# M-Team Executor 执行方法论

## What

Executor 拿到任务后的完整决策框架——如何判断接单、如何执行单步、如何判断交接、如何写 contextOutput、何时升级。

适用于所有在 M-Team 任务池中执行任务的 agent（maker / fixer / scholar / captain）。

## When

- 认领任务成功后，开始执行前
- 执行过程中遇到障碍，需要判断下一步
- 步骤完成，需要判断该 complete 还是 relay
- 任务完成后写 contextOutput
- 遇到自己处理不了的情况，需要判断升级还是重试

---

## 一、接单判断（claim 后首次决策）

### 决策树

```
认领成功
    │
    ├─► description 清楚吗？
    │     ├─ 否 → 立即 relay 回池子，step 写"description 模糊，无法判断执行方向"
    │     │
    │     └─ 是 → 继续
    │
    ├─► 我有足够信息完成吗？（上下文 / 文件路径 / 工具）
    │     ├─ 否，但可以自行获取 → 自行获取后继续
    │     │
    │     ├─ 否，且无法自行获取 → relay 回池子，step 写"缺少关键信息：{具体缺失}"
    │     │
    │     └─ 是 → 继续
    │
    └─► 属于我职责范围吗？（查 IDENTITY.md）
          ├─ 否 → relay 回池子，step 写"不属于 {role} 职责，建议转给 {建议角色}"
          └─ 是 → 开始执行
```

### 接单后第一步

向 task.json 写入第一条 context step，记录开始：

```json
{
  "type": "step",
  "executor": "{agentId}",
  "step": "开始执行：{description}",
  "output": { "summary": "已接单，开始执行" },
  "completedAt": {timestamp}
}
```

---

## 二、步骤执行框架

### 单步执行标准

每一步执行前，明确回答：

```
这一 step 的"完成标准"是什么？
产出需要包含哪三个要素？
有没有 STOP 条件（遇到就停止，不继续）？
```

### 做完后的思考（step 完成 → 判断下一步之间）

**做完任何一个子步骤后，不要立即决定下一步。先问自己：**

```
① 这个 step 本身是否已达到 description 要求的目标？
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

### 执行中写 Context

**原则：边做边写，不要最后一次性补。**

每完成一个子动作，追加一条 context step：

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

**contextOutput 传递给工具的参数格式：**
- `summary`（必须）：一句话说明这步做了什么 + 结果
- `files`（如有）：本次产出的文件路径列表
- `next_action`（如需交接）：告诉下一棒要做什么

存储到 task.json 时，工具参数 `contextOutput` 对应 DB 字段 `output`。

**不允许的 contextOutput：**
- 空 `{}`
- 只有文字分析没有数据或结论
- `summary: "进行中"`（这是状态，不是结果）

---

## 三、完成判断（何时 complete / relay / fail）

### 决策树

```
执行完成 or 认为完成
    │
    ├─► 任务目标（goal）是否已达成？
    │     ├─ 明确达成 → 进入"交接思考"
    │     ├─ 不确定是否达成 → 问自己：有没有办法验证？
    │     │       ├─ 能验证 → 验证后再判断
    │     │       └─ 不能验证 → 升级，写清楚"无法验证目标是否达成，原因：{...}"
    │     └─ 没有达成 → 继续判断
    │
    ├─► [交接思考] 任务是否需要下一步（需要不同角色或不同能力）？
    │     ├─ 是 → relay（不要自己强行做别人的部分）
    │     └─ 否 → 自己继续做或升级
    │
    ├─► 是否遇到技术障碍（工具不可用 / 信息缺失 / 环境问题）且无法自行解决？
    │     ├─ 是 → relay 回池子，写清楚障碍
    │     └─ 否 → 自己解决或升级
    │
    └─► 是否超过自己权限或涉及风险决策？
          ├─ 是 → 升级（不自己做判断）
          └─ 否 → 自己决定
```

### relay 标准动作

调用 `mteam_relay_task`（不放回池子，直接指定下一棒）：

```
contextStep = "交接给 {nextRole}：{具体下一步做什么}"
contextOutput = {
  "summary": "{这步完成的内容摘要}",
  "relay_to": "{nextRole}",
  "next_action": "{具体下一步：动词开头，边界清晰}",
  "handoff_context": "{下一棒需要知道的关键信息}"
}
```

### failTask 标准动作

调用 `mteam_failTask`（任务确实无法完成）：

```
contextStep = "任务失败：{原因}"
contextOutput = {
  "error": "{错误信息}",
  "failed_at": "{失败发生在哪一步}",
  "尝试过的方案": ["{方案1}", "{方案2}"]
}
```

---

## 四、升级判断（必须上报，不可自行决定）

满足**任一**立即升级，写清楚五条：

```
① 原始任务
② 当前状态
③ 卡点原因
④ 已尝试方案（至少两条）
⑤ 我的判断 + 选项A / B / C
```

**必须升级的场景：**

| 触发条件 | 上报内容 |
|---------|---------|
| 目标无法验证 | 说明无法验证什么 + 已尝试的验证方法 |
| 涉及风险决策 | 具体是什么风险 + 我的判断 |
| 任务本身有问题 | 方向性错误，还是条件不足 |
| 三次失败 | 前两次失败原因 + 本次失败原因 |
| 信息矛盾无法判断 | 矛盾的具体内容 + 各自依据 |

---

## 五、反模式（常见失误）

| 症状 | 根因 | 正确做法 |
|------|------|---------|
| relay 后下一棒说"不知道做什么" | relay 时 next_action 写得模糊 | relay 时 next_action 必须动词开头，边界清晰 |
| complete 后 Publisher 说不合格 | contextOutput.summary 写了"已完成"但没有数据 | summary 必须包含具体结果（数据/文件/结论） |
| 一直不 relay 也不 complete | 没有 STOP 条件判断 | 每步执行前先写 STOP 条件 |
| 升级后被说"这个你能自己判断" | 升级边界没搞清楚 | 先走完"能自行解决"的路径再升级 |
| context 只有一条"开始执行" | 没做到"边做边写" | 子动作完成立即追加 context step |
| description 说一步，executor 做了三步 | 没有"做完后的思考"环节 | 每步只做 description 规定的一件事，不多做 |
| description 说一步，executor 只做了一半就 complete | 缺少"交接思考" | relay 前先问"任务是否还有后续步骤需要其他人接力" |

---

## 六、自检清单（每步完成前检查）

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

---

## 七、多角色协作时的交接规则

### 常见角色职责参考

```
maker    → 实施类任务（写代码、改配置、跑脚本）
fixer    → 修复类任务（bug 定位、问题排查）
scholar  → 调研类任务（搜索、分析、总结）
captain  → 协调类任务（任务拆分、进度跟踪）
```

### 交接时必须传递的信息

relay 时 contextOutput 必须包含：

1. **已完成**：这步做了什么（结论/文件/数据）
2. **下一步**：下一棒要做什么（动词开头，1-3句话）
3. **关键上下文**：下一棒需要知道但不一定能自己查到的信息

### 不该交接的情况

- 自己能做但懒得做 → 不允许
- 做了一部分觉得难就交 → 先尝试两条不同方法再判断
- 只是不喜欢这个任务 → 不允许，必须有客观理由

---

## References

本 skill 是 M-Team executor 方法论的顶层入口。配套文件：

- **IDENTITY.md**（每个角色的身份定义）位于 `{workspaceRoot}/executors/{maker,fixer,scholar,captain}/IDENTITY.md`
- **SOUL.md**（每个角色的决策原则）位于 `{workspaceRoot}/executors/{maker,fixer,scholar,captain}/SOUL.md`
- **AGENTS.md**（每个角色的运行规范）位于 `{workspaceRoot}/executors/{maker,fixer,scholar,captain}/AGENTS.md`

执行任务前应先读对应角色的 IDENTITY.md + SOUL.md + AGENTS.md，再读本 skill 的决策树。

---

### 配套机制：heartbeat 分态注入

Executor 的 heartbeat session 由 `src/hooks/heartbeatPromptContribution.ts` 提供动态提示注入：

- **有 active task** → 注入任务上下文（goal + description + 最近3步）+ 本 skill 决策树
- **无 active task** → 注入空闲认领逻辑
- **Publisher** → 简化 prompt，不迭代已完成任务

Hook 通过 `api.tools.invoke({ name: 'mteam_get_agent_active', input: { agentId } })` 主动查询任务状态（`PluginHeartbeatPromptContributionEvent` 本身不携带任务字段）。
