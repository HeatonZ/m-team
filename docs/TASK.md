# M-Team Task Model

## 1. 文档目的

这篇只定义 **Task 对象、字段语义、状态机和状态转移规则**。

如果你要看：
- 为什么这样设计 → 看 `ARCHITECTURE.md`
- 运行时 heartbeat / executor / publisher 怎么流转 → 看 `SESSION.md`
- 代码在哪、模块怎么拆 → 看 `IMPLEMENTATION.md`

---

## 2. Task 是什么

Task 是 M-Team 任务池中的协作单元。

它不是一整段自由对话，也不是一个模糊待办，而是：

> 一个带有明确当前棒次、整体目标、历史上下文、状态语义和审计记录的链式协作对象。

Task 的职责是把多 Agent 协作约束成：
- 当前一棒做什么
- 已经做到了哪里
- 下一棒应如何承接
- 最终何时才算完成

---

## 3. 核心字段语义

### 3.1 `taskId`
任务唯一标识。

要求：
- 全局唯一
- 用于 sessionKey、日志、DB、文件路径、通知关联

### 3.2 `description`
`description` 是 **当前一棒唯一执行指令**。

它必须满足：
- 单步
- 可执行
- 可承接已有 context
- 不混入整条链总目标

它回答的是：
- 当前 executor 现在只做什么
- 做完应该留下什么结果

它不回答：
- 整个任务最终为什么
- 后续所有步骤全计划
- Publisher 怎么验收

### 3.3 `goal`
`goal` 是 **整体任务终态验收标尺**。

它回答的是：
- 整个任务最后要达成什么
- `agent_end` 在 complete 时要核对什么
- Publisher 在 close 时要验什么

它不负责告诉当前 executor 这一棒怎么做。

### 3.4 `context`
`context` 是 **已完成步骤历史**。

它不是全文聊天转储，而是结构化沉淀：
- 哪个 executor 做了哪一步
- 每一步留下了什么 summary
- 产生了哪些 files / unresolvedIssues / metrics
- 当前链路已经积累了哪些必要子结果

### 3.5 `status`
`status` 表示任务在任务池层面的占用状态。

建议语义：
- `pending`：待认领
- `running`：已被某个 executor 持有并执行中
- `completed`：executor 侧已完成，等待 publisher 验收
- `closed`：publisher 已验收关闭
- `failed`：失败，无法继续推进
- `cancelled`：发布者取消

### 3.6 `lifecycle`
`lifecycle` 表示任务在**流程语义层**处于哪个阶段。

它不是简单 UI 标签，而是状态机语义：
- 当前是在执行
- 在交接
- 在返工
- 在最终收口
- 或已完成

### 3.7 `publisher`
发布者 agentId。

负责：
- 发布任务
- 回收超时任务
- 验收 `completed` 任务
- close / reject / cancel

### 3.8 `executor`
当前持有任务的 executor。

- `pending` 时为空
- `running` 时应非空
- 被回收 / relay 后应清空，等待下一位认领

### 3.9 `lastExecutor`
上一位执行者。

用于：
- 审计链路
- 验证交接来源
- 防止某些 close / complete 语义漂移

### 3.10 时间字段
- `createdAt`
- `updatedAt`
- `completedAt`

用于：
- 排序
- 超时扫描
- Publisher 验收顺序
- 轨迹追溯

---

## 4. Context Step 结构

`context` 中每个 step 应至少包含：

- `type = step`
- `executor`
- `step`
- `output`
- `completedAt`

其中 `output` 建议至少包含：
- `summary`
- `files`
- `unresolvedIssues`
- `dataRefs`
- `metrics`

### 4.1 `summary`
当前一步的结构化结果摘要。

### 4.2 `files`
当前一步留下的可验证文件路径。

### 4.3 `unresolvedIssues`
当前一步仍未解决的问题。

如果存在关键未解决问题，就不应把任务误判成可 complete。

### 4.4 `dataRefs`
结构化数据引用，用于后续步骤承接。

### 4.5 `metrics`
指标型数据，用于计数、筛选、校验。

---

## 5. status 与 lifecycle 的分工

这两个字段不能混用。

### `status` 关注的是：
> 任务池当前占用状态是什么？

例如：
- 有没有人认领
- 是否已提交完成
- 是否已被关闭

### `lifecycle.phase` 关注的是：
> 整条链现在处于什么流程语义阶段？

例如：
- 正在执行当前一棒
- 正在准备交接下一棒
- 正在返工
- 正在最终收口

### 一个例子
一个任务可能：
- `status = pending`
- `lifecycle.phase = handoff`

这表示：
- 它现在没人持有
- 但它不是初始状态，而是**刚完成上一棒，正在等待下一棒认领**

所以不能只看 `status`，也不能只看 `phase`。

---

## 6. 推荐 phase 语义

### 6.1 `ready`
刚发布，尚未进入执行链。

### 6.2 `executing`
当前 executor 正在处理这一棒。

### 6.3 `handoff`
上一棒已完成，系统已形成明确下一棒，等待下一位 executor 认领。

这是链式任务的**默认主路径**。

### 6.4 `reworking`
已有进展，但下一棒属于返工 / 修正 / 补齐，而不是顺序向前推进。

### 6.5 `finalizing`
必要子结果已齐，只差最后整理 / 核对 / 汇总 / 输出。

**不是兜底态。**

### 6.6 `done`
executor 侧流程结束，publisher 验收前或验收后均可映射到终局阶段。

---

## 7. lifecycle 辅助字段

除了 `phase`，建议保留：
- `handoffCount`
- `reworkCount`
- `lastDecision`
- `lastDecisionAt`
- `loopGuard`

这些字段不是展示用附属品，而是状态机稳定性的一部分。

### 7.1 `lastDecision`
记录上一次 `agent_end` 的真实裁决：
- `relay`
- `retain`
- `complete`
- `fail`

### 7.2 `handoffCount`
记录顺向交接次数。

### 7.3 `reworkCount`
记录返工次数。

### 7.4 `loopGuard`
用于识别：
- 同一 description 重复
- 同一 phase 打转
- 无进展反复 retain
- finalizing 假收口

它是防止链路空转的必要机制。

---

## 8. 状态转移主规则

下面按任务池视角定义主转移。

### 8.1 发布
`publish`

转移为：
- `status: pending`
- `phase: ready`

含义：
- 任务已进入池子
- 尚未被任何 executor 持有

### 8.2 认领
`claim`

转移为：
- `status: running`
- `phase: executing`
- `executor = 当前认领者`

### 8.3 relay / handoff
当前一棒完成、整体 goal 未满足、且已形成明确下一棒时：

转移为：
- `status: pending`
- `phase: handoff` 或 `reworking`
- `executor = null`
- `lastExecutor = 上一位执行者`
- `description = nextDescription`

### 8.4 retain
当前一棒有进展，但不能安全 handoff / complete 时：

转移为：
- `status: running`
- `phase: executing` 或 `finalizing`
- `executor` 保持不变

### 8.5 complete
executor 侧判断整体 goal 已满足时：

转移为：
- `status: completed`
- `phase: done`
- `executor = null`

注意：
- `complete` 不是最终闭环
- 仍需 publisher `close`

### 8.6 close
publisher 验收通过：

转移为：
- `status: closed`
- `phase: done`

### 8.7 fail
任务阻塞且无法继续推进：

转移为：
- `status: failed`
- `phase` 进入终局失败态语义

### 8.8 cancel
publisher 主动取消：

转移为：
- `status: cancelled`

---

## 9. 状态机硬约束

### 约束 A
`description` 必须始终表示**当前一棒**。

一旦 relay 成功，`description` 就应切换成下一棒，而不是保留上一棒原文。

### 约束 B
`goal` 在全链中原则上保持稳定。

Reject / rework 可以改当前棒，但不应任意漂移整体终态。

### 约束 C
`handoff` 是链式任务默认主路径。

当当前棒完成而整体未完成时，系统应优先形成 `handoff`，不是优先 retain。

### 约束 D
`finalizing` 只能在必要子结果已齐时进入。

以下情况禁止进入 finalizing：
- 只完成了首棒
- 明显还缺关键子结果
- transcript 只是像总结
- 当前只有中间产物，没有终局收口条件

### 约束 E
`completed` 与 `closed` 必须分离。

- `completed` = executor 侧完成
- `closed` = publisher 验收通过

### 约束 F
同一条任务不能在无新增有效进展时无限 retain。

必须依赖 `loopGuard` 熔断。

---

## 10. Tool 与状态变更的对应关系

### `mteam_publish_task`
- 新建 task
- 写入 `goal / description / publisher`
- 任务进入 `pending + ready`

### `mteam_claim_task`
- 任务进入 `running + executing`
- 写入当前 `executor`

### `agent_end -> relayTask`
- 写入新 step 到 context
- description 切到 nextDescription
- 任务退回 `pending`
- phase 进入 `handoff / reworking`

### `agent_end -> retainTaskOwnership`
- 写入新 step 到 context
- 任务保持 `running`
- executor 不变
- phase 保持 `executing` 或进入 `finalizing`

### `agent_end -> completeTask`
- 写入收口 step
- 任务进入 `completed + done`

### `mteam_close_task`
- publisher 验收通过
- 任务进入 `closed`

### `mteam_reject_task`
- 发布者驳回
- 任务应回到可继续处理的链路状态
- description 应被改写成新的当前棒指令

### `mteam_relinquish_task`
- Publisher 心跳回收超时任务时使用
- 任务回到 `pending`
- 但不应改写成与事实不符的新链路语义

---

## 11. 任务模型自检清单

每次审查 task 设计时，至少问：

1. `description` 是不是只讲当前一棒？
2. `goal` 是不是只讲终态，不讲当前动作？
3. `context` 能不能让下一位 executor 接上？
4. `status` 和 `phase` 有没有被混用？
5. 当前转移是不是优先走了 `handoff`？
6. 有没有把 `finalizing` 当成兜底态？
7. `completed` 和 `closed` 有没有混在一起？

---

## 12. 最终结论

M-Team 的 Task 模型不是普通待办模型，而是：

> 一个围绕链式协作、单步执行、结构化承接、终态验收而设计的状态机对象。

如果 Task 模型守不住下面这条主口径，整套多 Agent 协作就会漂：

> **description 只表示当前一棒；handoff 是默认主路径；finalizing 不能当兜底态。**
