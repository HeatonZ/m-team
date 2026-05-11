# M-Team Task Model

## 1. 文档目的

这篇只定义 **Task 对象、字段语义和最小状态约束**。

如果你要看：
- 为什么采用 LLM-first 精简架构 → 看 `ARCHITECTURE.md`
- heartbeat / executor / publisher 怎么流转 → 看 `SESSION.md`
- 代码在哪、模块怎么拆 → 看 `IMPLEMENTATION.md`

---

## 2. Task 是什么

Task 是 M-Team 任务池中的协作单元。

它不是一段聊天记录，也不是模糊待办，而是：

> 一个带有当前一棒指令、整体目标、结构化历史、最小状态和审计轨迹的协作对象。

Task 的职责是把多 Agent 协作约束成：
- 当前一棒做什么
- 目前做到哪
- 任务现在能不能继续执行
- 最终什么时候才算完成

这里不再强调细粒度阶段字段，而强调：
- `agent_end` 负责理解任务流向
- Task 负责承载最小事实与约束

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
- 可承接已有 `context`
- 不混入整条链总目标

它回答的是：
- 当前 executor 现在只做什么
- 做完应留下什么结果

### 3.3 `goal`
`goal` 是 **整体任务终态验收标尺**。

它回答的是：
- 整个任务最后要达成什么
- `agent_end` 在 `complete` 时要核对什么
- Publisher 在 `close` 时要验什么

### 3.4 `context`
`context` 是 **已完成步骤历史**。

它不是全文聊天转储，而是结构化沉淀：
- 哪个 executor 做了哪一步
- 每一步留下了什么 summary
- 产生了哪些 files / unresolvedIssues / dataRefs / metrics
- 当前链路已经积累了哪些必要结果

### 3.5 `status`
`status` 是系统唯一主状态字段，用于表达最小任务约束。

推荐保留：
- `pending`
- `running`
- `completed`
- `closed`
- `failed`
- `cancelled`

它回答的是：
- 当前有没有人持有任务
- 任务是否还可继续执行
- 任务是否已进入待验收或终局状态

### 3.6 `publisher`
发布者 agentId。

负责：
- 发布任务
- 回收超时任务
- 验收 `completed` 任务
- `close / reject / cancel`

### 3.7 `executor`
当前持有任务的 executor。

- `pending` 时为空
- `running` 时应非空
- `relay / complete / fail / timeout 回收` 后通常清空

### 3.8 `lastExecutor`
上一位执行者。

用于：
- 审计链路
- 追溯交接来源
- 帮助理解当前 pending 状态前一棒是谁完成的

### 3.9 时间字段
- `createdAt`
- `updatedAt`
- `completedAt`

用于：
- 排序
- 超时扫描
- 验收顺序
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

如果存在关键未解决问题，就不应把任务误判成可 `complete`。

### 4.4 `dataRefs`
结构化数据引用，用于后续步骤承接。

### 4.5 `metrics`
指标型数据，用于计数、筛选、校验。

---

## 5. 为什么只保留一个主状态字段

M-Team 当前采用的是 **LLM-first 精简架构**。

这意味着：
- 任务理解交给 `agent_end` LLM
- 系统只保留最小约束状态

所以不再持久化额外的链路阶段字段。

像这些更细的语义：
- 是初始待认领还是 relay 后待认领
- 当前 running 是普通执行还是补收口
- 这一步为什么从 running 回到 pending

主要由：
- `context`
- 当前 `description`
- `lastExecutor`
- 最近一次 `agent_end` 决策和 task log

来解释。

---

## 6. 状态集合与语义

### 6.1 `pending`
任务在池中，当前无人持有，可被认领。

它可以表示：
- 初始发布后待认领
- relay 后待下一棒认领
- reject 后重新待认领
- timeout 回收后重新待认领

### 6.2 `running`
当前由某个 executor 持有并执行中。

### 6.3 `completed`
executor 侧已经提交“整体 `goal` 已满足”，等待 Publisher 验收。

### 6.4 `closed`
Publisher 已验收通过，业务闭环结束。

### 6.5 `failed`
任务已被判定为阻塞或不可恢复失败。

### 6.6 `cancelled`
任务被 Publisher 主动取消。

---

## 7. 最小决策集合如何映射到状态

M-Team 只保留四类任务级裁决：
- `relay`
- `retain`
- `complete`
- `fail`

### 7.1 `relay`
含义：
- 当前一棒已完成
- 整体 `goal` 还未满足
- 下一棒已明确

状态变化：
- 写 step 到 `context`
- `description = nextDescription`
- `executor = null`
- `lastExecutor = 当前 executor`
- `status = pending`

### 7.2 `retain`
含义：
- 当前有进展
- 但还不适合 `relay / complete`
- 当前 executor 继续持有任务

状态变化：
- 写 step 到 `context`
- `executor` 不变
- `status = running`
- `description` 可保持当前动作，或切成当前 executor 的补充动作

### 7.3 `complete`
含义：
- 整体 `goal` 已满足
- executor 已提交终态结果

状态变化：
- 写 step 到 `context`
- `executor = null`
- `status = completed`
- `completedAt` 赋值

### 7.4 `fail`
含义：
- 当前阻塞
- 无法继续推进
- 无明确合理下一棒

状态变化：
- 写 step 到 `context`
- `executor = null`
- `status = failed`

---

## 8. 任务模型硬约束

### 约束 A
`description` 必须始终表示**当前一棒**。

### 约束 B
`goal` 原则上保持稳定，不能随着每一棒漂移成新的总目标。

### 约束 C
`completed` 与 `closed` 必须分离。

- `completed` = executor 侧提交完成
- `closed` = Publisher 验收通过

### 约束 D
`pending` / `running` / `completed` 的合法迁移必须受系统控制。

不能靠 transcript 口头表述直接越权改状态。

### 约束 E
任务理解由 `agent_end` 完成，但状态写入合法性由系统保证。

也就是说：
- LLM 可以判断“该 relay”
- 但系统仍要保证这条 relay 是合法状态变更

---

## 9. Tool 与状态变化的对应关系

### `mteam_publish_task`
- 新建 task
- 写入 `goal / description / publisher`
- 任务进入 `pending`

### `mteam_claim_task`
- 任务进入 `running`
- 写入当前 `executor`

### `agent_end -> relayTask`
- 追加 step 到 `context`
- 切换 `description`
- 任务回到 `pending`

### `agent_end -> retainTaskOwnership`
- 追加 step 到 `context`
- 任务保持 `running`
- `executor` 不变

### `agent_end -> completeTask`
- 写入收口 step
- 任务进入 `completed`

### `mteam_close_task`
- Publisher 验收通过
- 任务进入 `closed`

### `mteam_reject_task`
- Publisher 驳回
- 任务回到可继续处理状态
- `description` 被改写成新的当前一棒

### `mteam_relinquish_task`
- Publisher 心跳回收超时任务时使用
- 任务回到 `pending`

---

## 10. 自检清单

每次审查 Task 设计时，至少问：

1. `description` 是不是只讲当前一棒？
2. `goal` 是不是只讲终态？
3. `context` 能不能支持下一棒承接？
4. `status` 是否足以表达最小系统约束？
5. 任务理解是不是尽量交给了 `agent_end`，而不是继续堆隐式规则？
6. `completed` 和 `closed` 有没有混掉？

---

## 11. 最终结论

M-Team 的 Task 模型当前追求的是：

> **一个最小状态约束对象 + 一个由 `agent_end` LLM 解释流向的协作任务模型。**

如果要守住这条主口径，最重要的是：

> **description 只表示当前一棒；status 只表示最小约束；复杂任务语义交给 `agent_end` LLM。**
