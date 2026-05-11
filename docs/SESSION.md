# M-Team Session Flow

## 1. 文档目的

这篇只讲 **运行时流程**：
- heartbeat session 做什么
- executor session 做什么
- `agent_end` 怎么裁决
- publisher 怎么回收 / 验收
- 一条任务从 publish 到 close 怎么流转

如果你要看：
- 为什么这样设计 → 看 `ARCHITECTURE.md`
- Task schema / phase / status 定义 → 看 `TASK.md`
- 代码模块在哪 → 看 `IMPLEMENTATION.md`

---

## 2. 运行时的四类角色

M-Team 运行时至少有四个职责位：

1. **Publisher**：发任务、回收超时、验收完成结果
2. **Heartbeat session**：只做认领 / publisher 验收，不直接执行任务
3. **Executor session**：只执行当前一棒
4. **agent_end**：在 executor 结束后统一裁决任务流向

这四者必须硬分离。

---

## 3. 总流程概览

```text
Publisher publish task
→ task 进入 pending
→ idle executor heartbeat 看到可认领任务
→ claim
→ task 进入 running / executing
→ executor session 执行当前一棒
→ executor 结束 session
→ agent_end 裁决
   → relay / handoff
   → retain
   → complete
   → fail
→ 若 completed，则等待 publisher heartbeat 验收
→ publisher close
```

这条链里最重要的原则是：

> executor 只做当前一棒；任务去向由 `agent_end` 决定；最终闭环由 publisher 验收完成。

---

## 4. Publisher 流程

### 4.1 Publisher 发布任务
Publisher 的输入是：
- `goal`
- 当前第一棒的 `description`
- `publisher`
- 可选 priority / type / 初始 context

发布后，任务进入：
- `status = pending`
- `phase = ready`

### 4.2 Publisher 不直接执行链路
Publisher 负责定义目标和验收，不负责顶替 executor 把链跑完。

如果 publisher 既发布又执行，会把：
- 发布
- 调度
- 执行
- 验收

四个职责重新搅在一起，失去任务池意义。

### 4.3 Publisher 心跳的职责
Publisher heartbeat 只做两类事：

#### A. 超时扫描
- 查询 `running` 任务
- 只看 `publisher = 自己` 的任务
- 用 `updatedAt` 判断超时
- 每次最多处理一个超时任务
- 超时则 `mteam_relinquish_task`

#### B. 验收 completed 任务
- 查询 `completed` 任务
- 只看 `publisher = 自己`
- 按完成顺序逐个验收
- 验收通过则 `close`
- 验收不通过则 `reject`

Publisher heartbeat 不应执行任务内容。

---

## 5. Heartbeat session 流程

### 5.1 Heartbeat session 的定位
Heartbeat 是调度入口，不是执行链。

对 executor 来说，heartbeat 只做：
- 看 pending task
- 判断当前一棒是否适合自己
- 认领任务

### 5.2 Heartbeat 认领的判断标准
认领时主要看：
- taskType
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
- 主动发布新任务（除明确 publisher 主动发布场景）

---

## 6. Executor session 流程

### 6.1 Executor session 启动条件
当 heartbeat 成功 `claim` 后，进入 executor session。

此时任务语义是：
- 当前 task 已由某 agent 持有
- 当前只需要完成 `description` 这一棒

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
- 越权 close / reject
- 自己定义任务“已经彻底完成”并跳过系统裁决
- 把整条链计划重新脑补成多步大纲

---

## 7. agent_end 裁决流程

`agent_end` 是整条运行流程的核心分叉器。

它在 executor session 结束后统一读取：
- 当前 `task`
- `goal`
- 当前 `description`
- 现有 `context`
- 本轮 transcript
- 本轮结构化 output

然后裁决：
- `fail`
- `complete`
- `relay`
- `retain`

---

## 8. agent_end 的推荐裁决顺序

### 8.1 `fail`
当出现以下情况时优先 fail：
- 当前阻塞
- 无法继续推进
- 没有形成可执行下一棒
- 继续 retain 只会空转

### 8.2 `complete`
仅当以下条件同时成立时：
- 整体 `goal` 已满足
- 当前没有关键未解决问题
- 有可验证的终态产物
- 当前确实已经到终局，而不是只完成一部分

### 8.3 `relay`
当以下条件成立时应优先 relay：
- 当前一棒已完成
- 整体 `goal` 仍未满足
- 下一棒已可明确描述

**这应是链式任务的默认主路径。**

### 8.4 `retain`
只有在以下场景才 retain：
- 当前有进展
- 但还不足以安全 relay / complete
- 继续由当前 executor 补一个短闭环最合理

retain 不是“先收着再说”的通用缓冲区。

---

## 9. relay / handoff 的运行语义

当 `agent_end` 决定 relay 时，应完成这些事情：

1. 把当前一步追加进 `context`
2. 生成 `nextDescription`
3. 清空当前 `executor`
4. 记录 `lastExecutor`
5. 把任务转回 `pending`
6. phase 进入 `handoff` 或 `reworking`

之后系统等待下一位 heartbeat 认领。

### 9.1 handoff 是常态
对链式任务来说，最健康的流向是：

```text
当前棒完成 → relay → 下一棒认领
```

而不是：

```text
当前棒完成 → retain → retain → retain → 最后硬收口
```

---

## 10. retain 的运行语义

当 `agent_end` 决定 retain 时：
- 当前 executor 继续持有任务
- 任务仍是 `running`
- description 保持当前棒或变成当前 executor 的补充收口动作
- phase 保持 `executing` 或进入 `finalizing`

retain 适用于：
- 同一执行者只差一个局部补齐动作
- 立刻 handoff 反而会丢上下文
- 当前不是跨角色交接，而是短闭环延续

### 10.1 不应滥用 retain
以下情况不应 retain：
- 实际上已经形成明确下一棒
- 当前更适合换人接
- 只因为 transcript 看起来像“还在整理”
- 整体 goal 未满足，但系统懒得生成下一棒

---

## 11. finalizing 的运行语义

`finalizing` 不是“系统先兜住”的状态。

它只表示：
- 必要子结果已齐
- 当前只差最后整理 / 汇总 / 核对 / 输出

### 11.1 正确进入 finalizing 的场景
例如：
- 三个子结果都已产出，只差汇总成最终文件
- 候选商品已经筛够，只差最后做终版结果表
- 所有中间产物齐全，只差最后验算和归档

### 11.2 禁止进入 finalizing 的场景
例如：
- 只做完第 1 棒
- 还缺关键子结果
- 当前 transcript 只是像总结
- 当前 executor 提前写了“结果摘要 / 最终整理”之类口径

---

## 12. complete 与 close 的分离

### 12.1 `complete`
表示：
- executor 侧认为整体 goal 已满足
- 并提交了终态结果
- 任务进入 `completed`

### 12.2 `close`
表示：
- publisher 验收通过
- 任务真正闭环

所以：
- `complete` 是执行链终点
- `close` 是业务闭环终点

这两个动作不能混成一个。

---

## 13. reject / timeout / fail 的运行路径

### 13.1 reject
Publisher 发现 completed 任务不合格：
- 不直接 close
- 必须 reject
- 并写出新的当前棒 description
- 让任务重新回到可处理状态

### 13.2 timeout relinquish
Publisher heartbeat 发现：
- 某 running 任务 `updatedAt` 超过阈值
- 则回收放回任务池

但超时回收不等于重写事实。
它只是：
- 释放占用
- 让后续 executor 接手

### 13.3 fail
当系统判断：
- 当前阻塞
- 无法继续
- 没有合理下一棒
- 再转只会空转

此时应 fail，而不是硬 retain。

---

## 14. 一条任务的标准时序

### 示例：三棒链式任务

```text
1. manager publish
   goal = 完成 A/B/C 三个子结果并汇总
   description = 当前先完成 A

2. maker heartbeat claim
3. maker executor session 完成 A
4. agent_end 判断：goal 未满足，但 B 已可描述
5. relay → description 改成“完成 B”
6. fixer heartbeat claim
7. fixer executor session 完成 B
8. agent_end 判断：goal 未满足，但 C 已可描述
9. relay → description 改成“完成 C”
10. scholar heartbeat claim
11. scholar executor session 完成 C
12. agent_end 判断：必要子结果已齐，只差汇总
13. retain / finalizing 或 relay 给汇总棒
14. 汇总完成后 complete
15. publisher heartbeat 验收
16. close
```

这个时序才符合 M-Team 的链式协作目标。

---

## 15. 运行流程自检清单

每次检查一条任务为什么跑偏，都先问：

1. heartbeat 有没有越权去执行？
2. executor 有没有越权去 relinquish / close？
3. `agent_end` 有没有优先尝试 relay？
4. 是否把可以 handoff 的场景错误 retain 了？
5. 是否把明显未完成的任务过早送进 finalizing？
6. `complete` 和 `close` 有没有混掉？
7. publisher 验收看的是整体 goal，还是只看最后一步 summary？

---

## 16. 最终结论

M-Team 的运行流程不是让所有 agent 都能“做点事”，而是：

> 让任务在 heartbeat、executor、agent_end、publisher 之间按清晰职责完成链式流转。

如果要守住这条流程，最重要的运行时原则就是：

> **executor 只做当前一棒；agent_end 决定流向；publisher 负责最终闭环。**
