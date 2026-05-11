# M-Team Session Flow

## 1. 文档目的

这篇只讲 **运行时流程**：
- heartbeat session 做什么
- executor session 做什么
- `agent_end` 怎么裁决
- Publisher 怎么回收 / 验收 / 驳回 / 关闭
- 一条任务从 publish 到 close 怎么流转

如果你要看：
- 为什么采用当前架构 → 看 `ARCHITECTURE.md`
- Task 对象和最小状态模型 → 看 `TASK.md`
- 代码模块在哪 → 看 `IMPLEMENTATION.md`

---

## 2. 运行时的四类角色

M-Team 运行时至少有四个职责位：

1. **Publisher**：发任务、回收超时、验收完成结果
2. **Heartbeat session**：
   - executor heartbeat 只做认领
   - publisher heartbeat 只做超时扫描与验收
3. **Executor session**：只执行当前一棒
4. **`agent_end`**：在 executor 结束后统一裁决任务流向

这四者必须硬分离。

---

## 3. 总流程概览

```text
Publisher publish task
→ task 进入 pending
→ idle executor heartbeat 看到可认领任务
→ claim
→ task 进入 running
→ executor session 执行当前一棒
→ executor 结束 session
→ agent_end 裁决
   → relay
   → retain
   → complete
   → fail
→ 若 relay，则回到 pending
→ 若 retain，则继续 running
→ 若 complete，则进入 completed
→ Publisher heartbeat 验收
→ close 或 reject
```

这条链里最重要的原则是：

> Executor 只做当前一棒；任务去向由 `agent_end` 决定；最终闭环由 Publisher 验收完成。

---

## 4. Publisher 流程

### 4.1 Publisher 发布任务
Publisher 的输入是：
- `goal`
- 当前第一棒的 `description`
- `publisher`
- 可选 `priority / taskType / 初始 context`

发布后，任务进入：
- `status = pending`

### 4.2 Publisher 不直接执行链路
Publisher 负责定义目标和验收，不负责顶替 executor 把链跑完。

如果 Publisher 既发布又执行，会把：
- 发布
- 调度
- 执行
- 验收

四个职责重新搅在一起，失去任务池意义。

### 4.3 Publisher heartbeat 的职责
Publisher heartbeat 只做两类事：

#### A. 超时扫描
- 查询 `running` 任务
- 只看 `publisher = 自己` 的任务
- 用 `updatedAt` 判断超时
- 每次最多处理一个超时任务
- 超时则 `mteam_relinquish_task`
- 处理完立即结束本次 heartbeat

#### B. 验收 `completed` 任务
- 仅在**本次 heartbeat 没有处理超时任务**时才进入
- 查询 `completed` 任务
- 只看 `publisher = 自己` 的任务
- 按 `completedAt` 升序逐个验收
- 每次 heartbeat 只验收一个任务
- 验收通过则 `close`
- 验收不通过则 `reject`
- 处理完立即结束本次 heartbeat

Publisher heartbeat 不应执行任务内容。

---

## 5. Heartbeat session 流程

### 5.1 Heartbeat session 的定位
Heartbeat 是调度入口，不是执行链。

对 executor 来说，heartbeat 只做：
- 看 `pending` task
- 判断当前一棒是否适合自己
- 认领任务

### 5.2 Heartbeat 认领的判断标准
认领时主要看：
- `taskType`
- `description`（当前一棒）
- `context`（前面做到哪）

不以 `goal` 作为主要认领判断。

因为：
- `goal` 是终态标尺
- 认领时只需要判断“这一步我能不能接”

### 5.3 Heartbeat 的禁止事项
Heartbeat session 不应：
- 执行任务内容
- 完成 / fail 任务
- spawn 子 agent 替代执行链
- 转发未经校验的执行结果
- executor heartbeat 主动发布新任务

---

## 6. Executor session 流程

### 6.1 Executor session 启动条件
当 heartbeat 成功 `claim` 后，进入 executor session。

此时任务语义是：
- 当前 task 已由某 agent 持有
- 当前只需要完成 `description` 这一棒
- 主状态为 `running`

### 6.2 Executor session 的职责
Executor 只负责：
- 读取当前 `description`
- 承接已有 `context`
- 完成当前一棒
- 产出结构化结果
- 结束 session

### 6.3 Executor 的正确输出
Executor 在结束前，至少应留下：
- 当前一步做了什么
- 产出了哪些文件 / 数据
- 还剩哪些问题

输出越结构化，`agent_end` 越容易做正确裁决。

### 6.4 Executor 不应做的事
Executor 不应：
- 主动 relinquish 当前任务
- 越权 close / reject / cancel
- 自己定义任务“已经彻底完成”并跳过系统裁决
- 把整条链重新脑补成多步计划

---

## 7. `agent_end` 裁决流程

`agent_end` 是整条运行流程的核心分叉器。

它在 executor session 结束后统一读取：
- 当前 `task`
- `goal`
- 当前 `description`
- 现有 `context`
- 本轮 transcript
- 本轮结构化 output

然后由 LLM 主裁决：
- `fail`
- `complete`
- `relay`
- `retain`

这里的重点不是继续堆 fallback 规则，而是：

> **把任务理解集中到 `agent_end`，把系统代码保留为状态和权限约束层。**

### 7.1 测试要求
当测试 `runAgentEnd()` 行为时，应显式 stub `agentEndJudge`/runtime judge，不能依赖隐式默认行为猜测任务会自动进入 `completed` 或 `pending`。

这是当前测试与文档必须一致的关键约束。

---

## 8. `agent_end` 的最小裁决顺序

### 8.1 `fail`
当出现以下情况时优先 fail：
- 当前阻塞
- 无法继续推进
- 没有形成可执行下一棒
- 再 retain 只会空转

### 8.2 `complete`
仅当以下条件同时成立时：
- 整体 `goal` 已满足
- 当前没有关键未解决问题
- 有可验证终态产物
- 当前确实已经到终局，而不是只完成一部分

结果通常是：
- `status = completed`

### 8.3 `relay`
当以下条件成立时应优先 relay：
- 当前一棒已完成
- 整体 `goal` 仍未满足
- 下一棒已可明确描述

`agent_end` 在这里应直接生成新的 `nextDescription`。

结果通常是：
- `status = pending`

### 8.4 `retain`
只有在以下场景才 retain：
- 当前有进展
- 但还不足以安全 relay / complete
- 继续由当前 executor 补一个短闭环最合理

retain 不是“先收着再说”的规则兜底区。

结果通常是：
- `status = running`

---

## 9. relay / retain / complete 的运行语义

### 9.1 relay
当 `agent_end` 决定 relay 时，应完成这些事情：
1. 把当前一步追加进 `context`
2. 生成 `nextDescription`
3. 清空当前 `executor`
4. 记录 `lastExecutor`
5. 把任务转回 `pending`

### 9.2 retain
当 `agent_end` 决定 retain 时：
- 当前 executor 继续持有任务
- 任务仍是 `running`
- `description` 保持当前棒，或切成当前 executor 的补充动作

### 9.3 complete
当 `agent_end` 决定 complete 时：
- 当前一步写入 `context`
- `executor` 清空
- 任务进入 `completed`
- `completedAt` 赋值

注意：
- `complete` 只是 executor 侧的完成提交
- 不是最终业务闭环

---

## 10. complete 与 close 的分离

### 10.1 `complete`
表示：
- executor 侧认为整体 `goal` 已满足
- 并提交了终态结果
- 任务进入 `completed`

### 10.2 `close`
表示：
- Publisher 验收通过
- 任务真正闭环
- 任务进入 `closed`

所以：
- `complete` 是执行链终点
- `close` 是业务闭环终点

这两个动作不能混成一个。

---

## 11. reject / timeout / fail 的运行路径

### 11.1 reject
Publisher 发现 `completed` 任务不合格：
- 不直接 `close`
- 必须 `reject`
- 驳回 reason 必须包含：
  - 问题描述
  - 下一步描述
- 系统从 reason 中解析新的 `nextDescription`
- 任务重新回到 `pending`

### 11.2 timeout relinquish
Publisher heartbeat 发现：
- 某 `running` 任务 `updatedAt` 超过 1 小时
- 则调用 `mteam_relinquish_task({ taskId, reason: '超时放回任务池' })`
- 任务释放占用，回到 `pending`

超时回收不等于系统理解了下一棒，只表示释放占用，让任务重新可认领。

### 11.3 fail
当系统判断：
- 当前阻塞
- 无法继续
- 没有合理下一棒
- 再转只会空转

此时应 fail，而不是继续堆规则 retain。

---

## 12. 当前已验证的高风险边界

当前 e2e 已覆盖这些关键运行边界：

1. Publisher heartbeat 先 timeout，后 acceptance
2. `completed -> close -> closed`
3. `completed -> reject -> pending + 新 description`
4. `agent_end relay` 后任务回池等待下一棒
5. `agent_end complete` 后任务等待 Publisher 验收
6. heartbeat / executor / Publisher 的权限边界

对应测试：
- `tests/e2e/publisher-acceptance-full-chain.e2e.test.ts`
- `tests/e2e/publisher-heartbeat-acceptance.e2e.test.ts`
- `tests/e2e/hook-runtime.e2e.test.ts`
- `tests/e2e/publisher-terminal-actions.e2e.test.ts`
- `tests/e2e/agent-end-llm-judge.e2e.test.ts`

---

## 13. 最终结论

M-Team 的运行时流程，不是“谁结束 session 谁决定任务命运”。

而是：

> heartbeat 负责认领或 Publisher 验收，executor 负责当前一棒，`agent_end` 负责任务级裁决，Publisher 负责最终业务闭环。
