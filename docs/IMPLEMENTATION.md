# M-Team Implementation Map

## 1. 文档目的

这篇只讲 **源码实现地图与模块边界**。

它回答的是：
- 代码在哪
- 各模块分别负责什么
- 哪些模块可以改，哪些边界不能混
- 在 LLM-first 架构下，复杂性应该压到哪里

如果你要看：
- 架构原则 → `ARCHITECTURE.md`
- Task 模型 / 最小状态约束 → `TASK.md`
- 运行时流程 → `SESSION.md`

---

## 2. 当前代码目录

以仓库根目录为准：

```text
src/
  config.ts
  index.ts
  dashboard.ts
  notifications.ts
  hooks/
  pool/
  schema/
  tools/

tests/
  e2e/
  helpers/
```

这是当前主要实现骨架。

---

## 3. 模块分工总览

### 3.1 `src/index.ts`
插件入口。

负责：
- 读取插件配置
- 设置 workspaceRoot
- 注册 tools
- 注册 hooks
- 启动 dashboard

它的职责是**装配**，不是承载任务理解逻辑。

### 3.2 `src/schema/`
数据模型定义。

负责：
- Task 结构
- `status` 等最小状态语义
- 类型约束

这里应该只定义“数据长什么样”，不应塞任务理解逻辑。

### 3.3 `src/pool/`
任务池核心。

负责：
- 任务创建
- 任务读取
- 任务状态变更
- DB 落盘
- 任务操作原子化封装

典型能力包括：
- `publishTask`
- `claimTask`
- `relayTask`
- `retainTaskOwnership`
- `completeTask`
- `failTask`
- `relinquishTask`
- `closeTask`

`pool` 是**状态变更层**，不是任务理解层。

### 3.4 `src/hooks/`
运行时编排层。

负责：
- session 边界控制
- heartbeat prompt 注入
- executor 结束后的任务级裁决
- 工具调用审计

这里是 LLM-first 架构里最关键的逻辑层。

### 3.5 `src/tools/`
对 agent 暴露的工具入口。

负责：
- registerTool
- 参数接收
- 调 pool 操作
- 返回结构化结果

tools 应保持薄，不要把复杂流程判断写进 tool handler。

### 3.6 `src/notifications.ts`
通知层。

负责：
- 任务状态变化后的通知格式化
- 对外通知下发

它不应定义任务真实状态，只负责把状态变化传出去。

### 3.7 `src/dashboard.ts`
可视化或本地 dashboard 进程。

负责：
- 展示任务状态
- 便于观察

它不是任务真相来源。真相来源仍是 task pool / DB。

---

## 4. hooks 目录的边界

### 4.1 `hooks/heartbeatPromptContribution.ts`
职责：
- 给 idle executor heartbeat 注入“认领任务”规则
- 给 Publisher heartbeat 注入“超时扫描 / 验收”规则

它只负责**行为引导**，不直接改任务状态。

### 4.2 `hooks/sessionGuard.ts`
职责：
- 拦截 heartbeat 越权执行
- 拦截 executor 越权 relinquish / close
- 保住 heartbeat / executor / Publisher 边界

它是**权限与会话边界层**。

### 4.3 `hooks/agentEnd.ts`
职责：
- 在 executor session 结束后统一裁决
- 决定 `relay / retain / complete / fail`
- 调用 `pool` 层做真实状态变更
- 写 task log

这是当前最关键的实现模块。

### 4.4 `hooks/agentEndLlm.ts`
职责：
- 为 `agent_end` 提供 LLM 裁决能力
- 基于 `goal / description / context / transcript / output` 生成决策

在 LLM-first 架构下，它不是辅助件，而是**主任务理解层**。

### 4.5 `hooks/afterToolCall.ts`
职责：
- 对 mteam_* 工具做审计落盘
- 记录 publish / claim / close / relinquish 等轨迹

它是审计层，不应反向决定任务流向。

---

## 5. pool 层的边界

`pool/` 应始终保持一个核心原则：

> pool 负责“执行合法状态变更”，不负责“理解任务语义”。

也就是说：
- `agent_end` 判断应该 relay
- `pool.relayTask()` 才去真正写 DB

而不是反过来在 `pool` 里塞大量语义判断。

### pool 层应承担的事
- 读写 task
- 原子更新状态
- 写 `context`
- 维护 `executor / lastExecutor`
- 持久化日志 / 数据

### pool 层不应承担的事
- 猜当前 transcript 是不是终局
- 自行判断 goal 是否满足
- 自己决定 relay 还是 retain
- 用规则模拟 LLM 任务理解

这些都应属于 `agent_end` 决策层。

---

## 6. schema / hook / pool / tool 的正确职责链

推荐职责链：

```text
schema
  定义数据结构

↓

tool
  暴露可调用入口

↓

hook
  根据运行时上下文做裁决 / 拦截 / 编排

↓

pool
  执行真实状态变更并落盘
```

其中最关键的变化是：

> **任务理解尽量集中在 hook（尤其是 `agent_end` LLM），而不是散落在 tool / pool / fallback 规则里。**

---

## 7. 当前实现最关键的敏感点

### 7.1 `agent_end` 是第一优先级模块
因为它决定：
- 当前棒是否完成
- 整体 `goal` 是否满足
- 是 `relay` 还是 `retain`
- 是否应 `complete / fail`

LLM-first 架构下，这里应该尽量成为唯一任务理解入口。

### 7.2 `sessionGuard` 是系统边界保险丝
如果 guard 松掉，会立刻出现：
- heartbeat 越权执行
- executor 越权 relinquish
- close / reject 权限漂移

所以它属于“少动，但一动必须带测试”的模块。

### 7.3 `afterToolCall` 是审计真相层
很多黑盒排查最后都要回到 task log。

所以：
- publish / claim / close / relinquish 的日志不能缺
- taskId / agentId / sessionKey 记录必须稳定

---

## 8. 当前实现应该如何测试

### 8.1 第一优先：`agent_end` 裁决边界测试
必须重点测：
- 当前一步完成但 overall goal 未完成时，应 relay 或 retain，而不是误 complete
- relay 时能不能稳定生成下一棒 description
- blocked 且无下一棒时应 fail
- complete 只能发生在真正满足整体 `goal` 时

### 8.2 第二优先：权限边界测试
必须重点测：
- heartbeat 不得执行任务
- heartbeat 不得 spawn / send
- executor task session 不得主动 relinquish
- 非 Publisher 不得 close / reject / cancel

### 8.3 第三优先：审计一致性测试
必须重点测：
- publish 是否写 task log
- claim / relay / complete / close 是否日志齐全
- 真实 taskId / sessionKey 是否对应正确

### 8.4 第四优先：真实链式 e2e 测试
必须重点测：
- A 做第1棒
- `agent_end` relay 给 B
- B 再 relay 给 C
- 最后 complete
- Publisher close

而不是只测“单 agent 做完一个任务”。

---

## 9. 后续代码改造的优先顺序

如果进入实现阶段，建议按下面顺序改：

### 第一步：先改 `agentEnd` / `agentEndLlm`
把复杂任务理解集中到这里。

### 第二步：收缩 schema / task model
保持最小 `status` 模型，不再把链路细语义持久化成状态机字段。

### 第三步：清理 fallback 规则
把旧的 transcript 启发式、细粒度阶段特判、兜底逻辑砍掉。

### 第四步：补测试
把 LLM-first 裁决边界固化。

### 第五步：最后再动 tool / notification / dashboard
这些都不应先于主裁决层修改。

---

## 10. 当前实现中不应继续扩散的坏味道

以下实现味道应避免继续增加：

1. 在 tool handler 里偷塞任务理解判断
2. 在 pool 层偷偷决定 relay / retain
3. 用 transcript 正则启发式替代整体 goal 判断
4. 用 patch 式 fallback 不断覆盖主裁决逻辑
5. 重新引入会和 `agent_end` 抢主导权的细粒度状态机

---

## 11. 开发者改动前自检清单

改任意一块代码前先问：

1. 这次改动是在改 schema、hook、pool 还是 tool？
2. 有没有越过模块边界把职责写混？
3. 这次改动会不会继续增加 fallback 规则，而不是减少它？
4. 这次改动是不是把任务理解继续收敛到了 `agent_end`？
5. 会不会让 heartbeat / executor / Publisher 边界变松？
6. 有没有对应 e2e / 边界测试？

---

## 12. 最终结论

M-Team 的实现不该继续沿着“重规则状态机”方向长，而应该稳定成下面这条职责链：

> **LLM 负责理解任务，hook 负责裁决流向，pool 负责落盘，tool 负责入口。**

只要这条边界守住，后续无论你优化 prompt、精简模型还是补测试，都不会再越改越乱。
