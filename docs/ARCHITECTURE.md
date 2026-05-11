# M-Team Architecture

## 1. 设计目标

M-Team 是一个面向 OpenClaw 的**多 Agent 任务池插件**。

它的目标不是把流程做成更重的状态机，也不是把所有语义都压成单一 `status`，而是把复杂协作拆成两层：

1. **LLM 负责任务理解与流向判断**
2. **系统负责状态、phase、权限、审计和持久化约束**

也就是说，M-Team 的主设计原则不是：
- 让规则越来越聪明
- 或者为了追求极简而抹平真实链路差异

而是：
- 让 `agent_end` 成为唯一任务级主裁决器
- 让代码层承担必要的状态合法性与权限边界
- 让 `status + lifecycle.phase` 共同表达“主状态 + 链路语义”

---

## 2. M-Team 解决的核心问题

在没有任务池和状态约束时，多 Agent 协作常见问题是：

- 任务目标和当前动作混在一起，Executor 容易越界
- 一个 session 结束后，系统不知道任务是该继续、该交接、还是该完成
- 中间结果不可验证，最后只能靠“我完成了”的口头成功口径
- Heartbeat、执行链、验收职责混在一起，造成状态污染
- 规则越修越多，最后 `agent_end` 变成一堆补丁型 if/else
- Publisher 的验收、驳回、超时回收顺序不明确，导致闭环不稳定

M-Team 的目标不是把所有情况写死，而是：

> **让 LLM 负责理解“这一步意味着什么”，让系统负责维护“这次状态变更是否合法、链路语义是否可追溯”。**

---

## 3. 核心设计原则

### 3.1 `description` 与 `goal` 严格分离
- `description`：当前一棒唯一执行指令
- `goal`：整体任务终态验收标尺

这两个字段不能混用。

`description` 只回答：
- 当前 executor 此刻只做什么

`goal` 只回答：
- 整个任务最后什么才算完成

### 3.2 Executor 只做当前一棒
Executor 的职责只有四件事：
- 读取当前 `description`
- 承接已有 `context`
- 完成当前一步
- 留下结构化产出

Executor 不应：
- 主动脑补整条链
- 越权 close / reject / cancel
- 把自己的口头成功当成任务终态

### 3.3 `agent_end` 是唯一任务级主裁决器
任务不会因为 session 结束就自动完成。

真正需要判断的是：
- 当前一步是不是完成了
- 整体 `goal` 是否满足
- 是否该 `relay`
- 是否该 `retain`
- 是否该 `complete`
- 是否该 `fail`

这类判断集中由 `agent_end` LLM 统一完成。

### 3.4 系统保留必要的状态与 phase 约束
系统层不负责理解任务内容，但负责维护这些事实：
- 这个任务能不能 claim
- 当前有没有 executor 持有
- completed 后还能不能继续执行
- 谁能 close / reject / cancel
- Publisher heartbeat 何时先做 timeout，再做 acceptance
- 这次状态变更是否合法
- 当前链路语义处于 `ready / executing / handoff / reworking / finalizing / done` 的哪一段

### 3.5 复杂性优先交给 LLM，但不能放弃系统保险丝
像这些问题：
- 这一步到底算不算完成
- 整体 goal 是否满足
- 下一棒应该怎么写
- 当前是该换人还是该继续由当前人补一下

更适合由 `agent_end` LLM 处理。

但这些问题仍需要系统兜底：
- 非 Publisher 不能 close / reject / cancel
- heartbeat 不能越权执行任务
- executor 不能主动 relinquish / close
- `completed` 与 `closed` 必须分离
- timeout reclaim 与 acceptance 的执行顺序必须稳定

---

## 4. 核心对象语义

### 4.1 Task
Task 是任务池里的协作单元，至少包含：
- `taskId`
- `description`
- `goal`
- `context`
- `status`
- `lifecycle`
- `publisher`
- `executor`
- `lastExecutor`
- `createdAt / updatedAt / completedAt`

### 4.2 `description`
`description` 是**当前一棒唯一执行指令**。

要求：
- 单步
- 可执行
- 可承接前序结果
- 不混入整条链总目标

### 4.3 `goal`
`goal` 是**整体任务终态验收标尺**。

它回答的是：
- 最终要完成什么
- `agent_end` 什么时候才能 `complete`
- Publisher 最终如何验收

### 4.4 `context`
`context` 是**已完成步骤历史**，不是全文聊天记录。

它应沉淀：
- 哪个 Executor 做了哪一步
- 每一步留下了什么 `summary / files / unresolvedIssues / metrics`
- 到目前为止已形成了哪些必要结果

### 4.5 `status`
`status` 是系统主状态字段，用于表达任务在约束层上的位置。

当前保留：
- `pending`
- `running`
- `completed`
- `closed`
- `failed`
- `cancelled`

### 4.6 `lifecycle.phase`
`lifecycle.phase` 是链路细分语义，不替代 `status`，而是补充说明当前运行段落。

当前有效 phase：
- `ready`
- `executing`
- `handoff`
- `reworking`
- `finalizing`
- `done`

分工是：
- `status` 回答“系统约束上现在处于什么主状态”
- `phase` 回答“这条链的当前细分语义是什么”

例如：
- `pending + ready`：新发布待认领
- `pending + handoff`：上一棒完成后待下一棒认领
- `pending + reworking`：Publisher 驳回后待返工
- `running + executing`：当前执行中
- `running + finalizing`：同一执行者补收口
- `completed + done`：executor 侧已完成，待 Publisher 验收
- `closed + done`：Publisher 已验收关闭

---

## 5. 角色边界

### 5.1 Publisher
Publisher 负责：
- 发布任务
- 定义 `goal`
- 回收超时任务
- 验收 `completed` 任务
- `close / reject / cancel`

Publisher 不负责代替 Executor 跑执行链。

### 5.2 Heartbeat session
Heartbeat session 只负责：
- Executor heartbeat：查看 `pending` 任务并认领
- Publisher heartbeat：做超时扫描与验收

Heartbeat 不应执行任务内容。

### 5.3 Executor session
Executor session 只负责：
- 承接当前 `description`
- 完成当前一步
- 输出结构化结果
- 结束 session，等待 `agent_end` 决定后续流向

### 5.4 `agent_end`
`agent_end` 是运行时核心裁决器。

它在 executor session 结束后，统一回答：
- 当前棒是否完成
- 整体 `goal` 是否满足
- 是否要 `relay / retain / complete / fail`
- 若 `relay`，下一棒 `nextDescription` 应该是什么

---

## 6. 状态与 phase 的双层模型

M-Team 当前真实设计不是单层 status-only，也不是 phase 取代 status，而是双层模型。

### 6.1 主状态 `status`
用于系统约束：
- 是否可认领
- 是否有人持有
- 是否进入待验收
- 是否已终态

### 6.2 细分语义 `phase`
用于表达链路段落：
- 新建待接手
- 正在执行
- 已交接待下一棒
- 驳回返工
- 收口补齐
- 完成收口

### 6.3 为什么不能只留其中一层
只留 `status` 的问题：
- 无法区分 `pending` 是新任务、handoff 还是 reworking
- 无法区分 `running` 是执行中还是 finalizing
- 文档、看板、测试和审计会丢掉关键业务语义

只留 `phase` 的问题：
- 权限与状态约束判断不稳定
- `close / reject / cancel / claim` 等工具难以统一保护

所以当前正确口径是：

> **`status` 负责约束，`phase` 负责解释；二者共同组成真实运行态。**

---

## 7. 最小裁决集合

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
- 任务交回池子等待下一位认领

典型结果：
- `status = pending`
- `phase = handoff`

### 7.2 `retain`
含义：
- 当前有进展
- 但还不适合 handoff / complete
- 当前 executor 继续持有任务完成下一小段补充动作

典型结果：
- `status = running`
- `phase = executing` 或 `finalizing`

### 7.3 `complete`
含义：
- 整体 `goal` 已满足
- executor 已提交终态结果
- 任务进入待 Publisher 验收状态

典型结果：
- `status = completed`
- `phase = done`

### 7.4 `fail`
含义：
- 当前阻塞
- 无法继续推进
- 没有合理下一棒

典型结果：
- `status = failed`
- `phase` 通常保持最近有效语义或进入失败后的终止态表达

---

## 8. 生命周期主路径

当前主路径是：

```text
publish
→ pending + ready
→ heartbeat claim
→ running + executing
→ agent_end adjudication
→ relay / retain / complete / fail
→ 若 relay，则 pending + handoff 或 reworking
→ 若 retain，则 running + executing/finalizing
→ 若 complete，则 completed + done
→ publisher close / reject
```

Publisher 验收链路中还包含一条固定优先级：

```text
publisher heartbeat
→ 先扫描 running 超时任务（按 updatedAt，最多处理 1 个）
→ 无超时任务时再验收 completed 任务（每次只处理 1 个）
```

---

## 9. 设计边界：LLM 能替代什么，不能替代什么

### LLM 负责
- 当前一棒是否完成
- 整体 `goal` 是否满足
- 是否应 `relay / retain / complete / fail`
- relay 时 `nextDescription` 怎么写

### 系统负责
- claim 是否合法
- 当前是否已有 executor 持有
- completed 后是否还能执行
- 谁能 close / reject / cancel
- timeout reclaim 口径是否一致
- reject 后 description 如何回写
- 状态与 phase 是否可合法落盘

这两层必须分开。

---

## 10. 本轮已确认的关键事实

当前代码、prompt 与 e2e 已确认：

- Publisher heartbeat 先做 timeout，再做 acceptance
- timeout 判定口径是 `updatedAt` 距今超过 1 小时
- 每次 heartbeat 最多处理 1 个 timeout 任务
- `mteam_close_task` 只能关闭 `completed` 任务
- `mteam_reject_task` 会把任务打回 `pending`，并从 reason 解析新的 `nextDescription`
- `agent_end` 的任务级主裁决来自 `agentEndJudge` / LLM；测试应显式 stub

---

## 11. 最终结论

M-Team 当前最准确的架构口径不是“继续强化重规则状态机”，也不是“彻底去 phase 化”。

而是：

> **把任务理解集中到 `agent_end` LLM，同时保留 `status + lifecycle.phase` 双层状态模型，让系统负责权限、合法迁移、超时回收、Publisher 验收与审计。**
