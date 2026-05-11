# M-Team Implementation Map

## 1. 文档目的

这篇只讲 **源码实现地图与模块边界**。

它回答的是：
- 代码在哪
- 各模块分别负责什么
- 哪些模块可以改，哪些边界不能混
- 测试重点应该压在哪里

如果你要看：
- 架构原则 → `ARCHITECTURE.md`
- Task 模型 / 状态机 → `TASK.md`
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

它的职责是**装配**，不是承载业务规则细节。

### 3.2 `src/schema/`
数据模型定义。

负责：
- Task 结构
- phase / status / lifecycle 等模型语义
- 类型约束

这里应该只定义“数据长什么样”，不应塞运行时裁决逻辑。

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

`pool` 是**状态变更层**，不是“怎么判断该变什么状态”的层。

### 3.4 `src/hooks/`
运行时编排层。

负责：
- session 边界控制
- heartbeat prompt 注入
- executor 结束后的状态裁决
- 工具调用审计

这里是 M-Team 最关键的运行时逻辑层。

### 3.5 `src/tools/`
对 agent 暴露的工具入口。

负责：
- registerTool
- 参数接收
- 调 pool 操作
- 返回结构化结果

tools 应保持薄，不要把复杂状态机逻辑写进 tool handler。

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
- 给 publisher heartbeat 注入“超时扫描 / 验收”规则

它只负责**行为引导**，不直接改任务状态。

### 4.2 `hooks/sessionGuard.ts`
职责：
- 拦截 heartbeat 越权执行
- 拦截 executor 越权 relinquish / close
- 保住 heartbeat / executor / publisher 边界

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
- 基于 goal / description / context / transcript / output 生成裁决

注意：
- 它是裁决器，不是事实来源
- 不能让 LLM 输出覆盖架构硬规则

### 4.5 `hooks/afterToolCall.ts`
职责：
- 对 mteam_* 工具做审计落盘
- 记录 publish / claim / close / relinquish 等轨迹

它是审计层，不应反向决定状态机规则。

---

## 5. pool 层的边界

`pool/` 应始终保持一个核心原则：

> pool 负责“执行状态变更”，不负责“发明状态机判断”。

也就是说：
- `agent_end` 判断应该 relay
- `pool.relayTask()` 才去真正写 DB

而不是反过来在 `pool` 里塞大量判断分支。

### pool 层应承担的事
- 读写 task
- 原子更新状态
- 写 context
- 更新 lifecycle
- 维护 executor / lastExecutor
- 持久化日志 / 数据

### pool 层不应承担的事
- 猜当前 transcript 是不是终局
- 自行判断 goal 是否满足
- 自己决定 relay 还是 retain

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

如果这条链被打乱，就容易出现：
- 工具层偷偷改业务规则
- pool 层偷偷做裁决
- hook 层和 schema 口径不一致

---

## 7. 当前实现最关键的敏感点

### 7.1 `agent_end` 是一等敏感模块
因为它决定：
- 是 handoff 还是 retain
- 是 complete 还是 fail
- 会不会过早进入 finalizing

所以任何修改都必须围绕主架构规则：
- handoff 是默认主路径
- retain 是例外
- finalizing 不是兜底态

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

### 8.1 第一优先：状态机边界测试
必须重点测：
- 单步完成但 overall goal 未完成时，不能误 complete
- 可 handoff 时不能误 retain
- 未满足终局条件时不能误进 finalizing
- blocked 且无下一棒时应 fail，不应空转

### 8.2 第二优先：权限边界测试
必须重点测：
- heartbeat 不得执行任务
- heartbeat 不得 spawn / send
- executor task session 不得主动 relinquish
- 非 publisher 不得 close / reject / cancel

### 8.3 第三优先：审计一致性测试
必须重点测：
- publish 是否写 task log
- claim / relay / complete / close 是否日志齐全
- 真实 taskId / sessionKey 是否对应正确

### 8.4 第四优先：真实链式 e2e 测试
必须重点测：
- A 做第1棒
- 系统 relay 给 B
- B 再 relay 给 C
- 最后进入 finalizing / complete / close

而不是只测“单 agent 完成一个任务”。

---

## 9. 修改代码时的优先顺序

如果后续进入实现阶段，建议按下面顺序改：

### 第一步：先改 `agentEnd` 决策规则
因为这里最直接决定主路径是否正确。

### 第二步：再改 `agentEndLlm` prompt / 输出约束
防止 LLM 继续把链式任务误收口。

### 第三步：补测试
把链式 handoff / finalizing 边界固化。

### 第四步：最后再动 tool / notification / dashboard
这些都不应先于主状态机规则修改。

---

## 10. 当前实现中不应再继续扩散的坏味道

以下实现味道应避免继续增加：

1. 在 tool handler 里偷塞状态判断
2. 在 pool 层偷偷决定 relay / retain
3. 用 UI 文案替代真实状态机语义
4. 用“看起来像完成”替代 goal 校验
5. 把 finalizing 当成安全兜底区
6. 用 patch 文档长期弥补主文档缺失

---

## 11. 开发者改动前自检清单

改任意一块代码前先问：

1. 这次改动是在改 schema、hook、pool 还是 tool？
2. 有没有越过模块边界把职责写混？
3. 这次改动会不会让 retain 比 relay 更容易触发？
4. 会不会让 finalizing 更容易被误用？
5. 会不会让 heartbeat / executor / publisher 边界变松？
6. 有没有对应 e2e / 边界测试？

---

## 12. 最终结论

M-Team 的实现不能只是“把几个工具和 hook 拼起来”，而必须维持下面这条稳定职责链：

> **hook 负责裁决，pool 负责落盘，tool 负责入口，schema 负责约束。**

只要这条边界守住，后续无论你优化 prompt、状态机还是测试，都不会再越改越乱。
