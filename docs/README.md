# M-Team Docs

M-Team 是一个面向 OpenClaw 的**链式多 Agent 任务池插件**。

它解决的不是“让多个 Agent 同时说话”，而是把多 Agent 协作拆成**一棒一棒可追踪、可交接、可验收的任务链**：

- Publisher 发布任务
- Heartbeat session 只负责认领
- Executor session 只负责完成当前一棒
- `agent_end` 在 executor 结束后统一裁决：`relay / retain / complete / fail`
- Publisher 最终验收并关闭任务

---

## 先读哪几篇

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md)
先看这篇。它定义 M-Team 的**唯一架构主口径**：
- M-Team 要解决什么问题
- 核心对象语义是什么
- 各角色边界是什么
- 生命周期主路径是什么
- 为什么 `handoff` 才是链式任务的默认主路径

### 2. [TASK.md](./TASK.md)
如果你要理解**任务对象和状态机**，看这篇：
- Task schema
- description / goal / context / lifecycle 的定义
- status / phase 的含义
- 状态转移规则

### 3. [SESSION.md](./SESSION.md)
如果你要理解**运行时流程**，看这篇：
- heartbeat session 做什么
- executor session 做什么
- `agent_end` 怎么收口
- Publisher 怎么验收和回收超时任务

### 4. [IMPLEMENTATION.md](./IMPLEMENTATION.md)
如果你要改代码，读这篇：
- 源码目录结构
- 各模块职责边界
- hook / pool / db / notifications 的分工
- 测试重点应该压在哪

---

## 全套文档的统一核心口径

这些口径在所有文档里都必须一致：

- `description = 当前一棒唯一执行指令`
- `goal = 终态验收标尺`
- `context = 已完成步骤历史`
- `agent_end = 唯一终态裁决器`
- `handoff = 链式任务默认主路径`
- `retain = 例外路径，不是常态`
- `finalizing = 只在必要子结果已齐时进入，不是兜底态`

如果你看到某份文档和上面冲突，以 `ARCHITECTURE.md` 为准，并应立即修正文档漂移。

---

## 当前最重要的设计结论

M-Team 必须把**链式任务**当成第一公民来设计：

1. Executor 只做当前一棒，不负责脑补整条链
2. 当前一棒完成后，系统默认应优先尝试 `relay / handoff`
3. 不能因为 transcript 看起来像“在整理结果”，就过早进入 `finalizing`
4. `finalizing` 只能发生在“必要子结果已经齐了，只差最后收口”的阶段

---

## 文档维护规则

- 不要把临时 bug 写成长期规范
- 补丁类设计说明应最终并回主文档
- 一篇文档只回答一种问题，避免 README / 架构 / 流程 / 安装互相重复
