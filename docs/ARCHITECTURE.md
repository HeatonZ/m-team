# M-Team Architecture

## 1. 设计目标

M-Team 是一个面向 OpenClaw 的**链式多 Agent 任务池插件**。

它的目标不是简单地把任务分给不同 Agent，而是把复杂协作任务拆成：

- 可发布
- 可认领
- 可执行
- 可交接
- 可验收
- 可回溯

的一系列**单步任务棒次**。

系统必须支持这样的协作方式：

1. Publisher 定义任务目标
2. Executor 只完成当前一棒
3. 系统在每一棒结束后判断：
   - 是否可以交给下一棒
   - 是否需要当前执行者继续收口
   - 是否已经满足整体 goal
   - 是否应直接失败而不是继续空转
4. Publisher 对整体结果验收并关闭任务

---

## 2. M-Team 解决的核心问题

在没有任务池和状态机时，多 Agent 协作常见问题是：

- 任务目标和当前动作混在一起，Executor 容易越界
- 多个 Agent 之间没有明确接棒点，过程不可追踪
- 中间结果不可验证，最后只能靠“我完成了”的口头成功口径
- Heartbeat、执行链、验收职责混在一起，造成状态污染
- 一个 Agent 的模糊汇报，会把整条链过早拉向“完成”或“收口”

M-Team 的架构就是为了解决这些问题。

---

## 3. 核心设计原则

### 3.1 链式任务是第一公民
M-Team 默认面对的是**多步、多棒次、可交接**任务，而不是“单个 Agent 一次做完”的任务。

因此系统主路径必须围绕**handoff**设计，而不是围绕“当前 Agent 自己收口”设计。

### 3.2 description 与 goal 严格分离
- `description`：当前一棒唯一执行指令
- `goal`：整体任务终态验收标尺

这两个字段不能混用。

**description 不能承担：**
- 整条链的总目标
- 全流程计划说明
- Publisher 的验收标准全文

**goal 不能承担：**
- 当前一棒具体怎么做
- 当前执行者此刻该做什么

### 3.3 Executor 只做当前一棒
Executor 的职责是：
- 读取当前 `description`
- 利用已有 `context` 承接前序结果
- 完成当前这一步
- 留下结构化产出和可验证证据

Executor 不应：
- 自行改写整条任务链目标
- 主动脑补后续多步计划
- 越过系统直接做 Publisher 决策

### 3.4 agent_end 是唯一终态裁决器
任务不会因为 Executor “自称完成”就直接完成。

真正的流向判断必须由 `agent_end` 统一完成：
- `relay`
- `retain`
- `complete`
- `fail`

这样才能保证：
- session 内执行行为
- session 结束后的状态判断
- 任务池状态变更

三者有统一控制点。

### 3.5 handoff 是默认主路径，retain 是例外
对链式任务来说：
- **handoff / relay 是常态**
- **retain 是例外**

也就是说，当当前一棒完成但整体 goal 未满足时，系统应优先尝试形成下一棒，而不是优先让当前 Agent 继续占有任务。

### 3.6 finalizing 不是兜底态
`finalizing` 只能表示：

> 所有必要子结果已经齐了，只差最后整理、核对、汇总、验收收口。

它不能表示：
- 系统暂时不知道下一步怎么办
- transcript 看起来“像在总结”
- 当前 Agent 写了结果摘要
- 只有一部分子结果完成，但已经开始口头汇总

如果把 `finalizing` 当作模糊兜底态，它会吞掉正确的 handoff。

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
- `executor / lastExecutor`
- `createdAt / updatedAt / completedAt`

### 4.2 description
`description` 是**当前一棒唯一执行指令**。

它必须满足：
- 单步
- 可执行
- 可交接
- 不混入整条链总目标

好的 description 应该让 Executor 一眼知道：
- 现在只做什么
- 做完留下什么
- 哪些前序结果要继承

### 4.3 goal
`goal` 是**整体任务终态验收标尺**。

它回答的是：
- 任务最终要达成什么
- Publisher 最终如何判断通过
- agent_end 在 complete 时要核对什么

### 4.4 context
`context` 是**已完成步骤历史**，不是聊天记录全文。

它应该沉淀：
- 哪个 Executor 做了哪一步
- 每一步产出的 summary / files / unresolvedIssues / metrics
- 当前链路已经完成了哪些必要子结果

### 4.5 lifecycle
`lifecycle` 描述任务处于哪一类流程阶段，例如：
- ready
- executing
- handoff
- reworking
- finalizing
- done

它表达的是**流程语义**，不是简单 UI 状态。

---

## 5. 角色边界

### 5.1 Publisher
Publisher 负责：
- 发布任务
- 定义 `goal`
- 在必要时回收超时任务
- 对 completed 任务进行最终验收
- 关闭 / 驳回任务

Publisher 不负责代替 Executor 完成执行链。

### 5.2 Heartbeat session
Heartbeat session 只负责：
- 查看 pending task
- 判断自己是否适合认领当前一棒
- 认领任务
- Publisher heartbeat 负责超时扫描和最终验收

Heartbeat session 不是执行链，不应直接执行任务内容。

### 5.3 Executor session
Executor session 只负责：
- 承接当前 `description`
- 完成当前一棒
- 输出结构化结果
- 结束 session，让 `agent_end` 裁决后续流向

Executor session 不负责：
- 主动 relinquish 当前任务
- 越权 close / reject
- 把自己的口头成功当成系统终态

### 5.4 agent_end
`agent_end` 是运行时最关键的状态裁决器。

它负责在 executor session 结束后统一判断：
- 当前是否已满足整体 `goal`
- 是否形成了明确下一棒
- 当前执行者是否必须继续收口
- 是否应失败而不是继续空转

---

## 6. 生命周期主路径

M-Team 的推荐主路径是：

```text
publish
→ pending
→ heartbeat claim
→ executing
→ agent_end adjudication
→ relay / handoff
→ 下一个 executor claim
→ ...
→ finalizing
→ complete
→ publisher close
```

这条路径表达的不是 UI 流程，而是系统默认协作哲学：

1. Publisher 发起任务
2. 空闲 executor 在 heartbeat 中只认领
3. Executor session 只执行当前一棒
4. 每一棒结束后，由 `agent_end` 统一判断去向
5. 只在必要子结果已齐时进入 `finalizing`
6. 只有完成与验收分离，Publisher 关闭任务后，任务才真正闭环

---

## 7. agent_end 的职责与优先级

`agent_end` 的唯一职责是：

> 基于 `goal + current description + context + transcript + output`，判断任务的下一步流向。

推荐的决策优先级应是：

1. **fail**：当前阻塞且无法形成可执行下一棒
2. **complete**：整体 `goal` 已满足，且已有可验证终态产物
3. **relay**：当前一棒已完成，整体 `goal` 未满足，且能形成明确下一棒
4. **retain**：已有进展，但当前还不足以安全 relay / complete，需要当前执行者继续收口

这里最关键的是：

- 对链式任务，`relay` 应该是默认优先路径
- `retain` 只能在确实无法安全 handoff 时使用
- 不能因为 transcript 里出现“结果摘要 / 汇总 / 最终整理”就直接进入 finalizing

---

## 8. nextDescription 的生成原则

下一棒不是靠 Executor 自由发挥，而是由系统基于整体任务状态稳定生成。

### nextDescription 必须满足
- 单步
- 可执行
- 不复写前一步
- 不混入整条任务目标
- 能让下一个 Executor 直接开工

### 系统生成下一棒时，至少要看
- 当前 `description` 完成了什么
- `goal` 还缺什么
- `context` 已经有哪些结果
- 当前输出是否留下了足够承接证据

### 系统不应依赖
- Executor 显式写“下一步：...”才知道怎么接

Executor 可以提供线索，但链式任务的接棒生成能力必须是系统能力，不是执行者自觉。

---

## 9. finalizing 的进入条件

只有同时满足以下语义时，才应进入 `finalizing`：

1. `goal` 的必要子结果已经基本齐全
2. 当前缺的只是最终整理 / 核对 / 汇总 / 输出
3. 当前不存在会改变结论方向的关键缺口
4. `context` 已能证明整条链已经接近闭环

以下情况都**不应**进入 `finalizing`：

- 只完成了第 1 棒
- 还缺关键子结果
- 只是 transcript 写得像总结
- 当前 Agent 只留下部分中间结果
- 整体 `goal` 仍明显未满足

---

## 10. retain 的正确定位

`retain` 的正确含义不是“先别动，等等看”，而是：

> 当前已有进展，但为了安全和正确性，仍应由当前 Executor 继续持有并完成收口动作。

因此 retain 只适合：
- 还差一个局部补齐动作就可形成明确 handoff
- 当前 Executor 最了解刚刚生成的中间状态
- 当前不是跨角色交接，而是同一执行者应补完一个短闭环

如果整体更像“当前一棒完成，下一棒应由别人承接”，那就应优先 `relay`。

---

## 11. Publisher 验收原则

Publisher 验收的是**整体 goal 是否实现**，不是只看最后一步 summary。

验收必须同时核对：
- `goal` 是否真正达成
- `context` 路径是否完整
- 产物是否可验证
- 是否存在凑数步骤或无意义重复

因此：
- `complete` ≠ 任务真正结束
- `close` 才是 Publisher 验收通过后的最终闭环

---

## 12. 当前架构必须守住的硬原则

### 原则 A
`description` 只描述当前一棒，不描述整条链。

### 原则 B
`goal` 只做终态标尺，不做当前执行指令。

### 原则 C
Executor 结束后，系统默认优先尝试 `relay / handoff`。

### 原则 D
`retain` 是例外，不是默认收口方式。

### 原则 E
`finalizing` 只在必要子结果已齐时进入，绝不能当兜底态。

### 原则 F
Publisher 的关闭动作与 Executor 的完成动作必须保持分离。

---

## 13. 最终结论

M-Team 的基础架构不是“让多个 Agent 都能动起来”，而是：

> 让多 Agent 协作任务可以被拆成一系列**单步、可验证、可交接、可验收**的任务棒次。

要实现这一点，最重要的不是再加更多工具，而是守住下面这条主架构口径：

> **链式任务里，handoff 是常态，retain 是例外，finalizing 不是兜底。**

后续所有实现、测试、文档、Prompt、验收规则，都必须围绕这条主路径收敛。
