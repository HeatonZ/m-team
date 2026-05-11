# M-Team Docs

M-Team 是一个面向 OpenClaw 的**多 Agent 任务池插件**。

当前 docs 的统一口径是：

- `status` 表达系统主状态约束
- 不再持久化额外的链路阶段字段
- Executor 只负责完成当前一棒
- `agent_end` LLM 是唯一任务级主裁决器
- Publisher 负责超时回收与最终验收闭环

也就是说，M-Team 当前真实设计是：

> **LLM 负责理解任务流向；系统负责状态、权限、审计和持久化的一致落盘。**

---

## 先读哪几篇

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md)
先看这篇。它定义 M-Team 的主架构口径：
- M-Team 要解决什么问题
- 为什么采用 LLM-first 裁决
- `status` 与 `agent_end` 如何分工
- 各角色边界是什么
- 哪些判断交给 `agent_end`，哪些必须由系统兜住

### 2. [TASK.md](./TASK.md)
如果你要理解任务对象和状态模型，看这篇：
- Task schema
- `description / goal / context / status` 的定义
- 最小状态约束如何工作
- 裁决动作如何改变任务状态

### 3. [SESSION.md](./SESSION.md)
如果你要理解运行时流程，看这篇：
- heartbeat session 做什么
- executor session 做什么
- `agent_end` 怎么裁决
- Publisher 怎么超时回收、验收、驳回、关闭

### 4. [IMPLEMENTATION.md](./IMPLEMENTATION.md)
如果你要改代码，读这篇：
- 源码目录结构
- 各模块职责边界
- hook / pool / db / notifications 的分工
- 哪些复杂性应集中在 `agent_end`，哪些必须留在系统约束层

### 5. [test-cases/README.md](./test-cases/README.md)
如果你要补测试或核对文档覆盖，看这篇：
- 当前自然语言用例索引
- 哪些用例仍带有历史状态机口径
- 哪些场景已被新的 e2e 覆盖

---

## 全套文档的统一核心口径

这些口径在所有文档里都必须一致：

- `description = 当前一棒唯一执行指令`
- `goal = 终态验收标尺`
- `context = 已完成步骤历史`
- `status = 系统主状态`
- `agent_end = 唯一任务级主裁决器`
- `next / complete / fail = 最小裁决集合`
- `complete != close`，Publisher 必须做最终验收
- 复杂语义判断优先交给 LLM；权限、状态合法性、超时回收、验收入口由系统强约束

如果某份文档和上面冲突，以 `ARCHITECTURE.md` 为准，并应立即修正文档漂移。

---

## 当前最重要的设计结论

M-Team 当前不是“继续堆规则”，也不是“再造一个细粒度状态机”。

而是三件事并行：

1. **把任务理解集中到 `agent_end` LLM**
2. **保留最小必要的 `status` 主状态模型**
3. **把系统限制在权限、状态迁移、超时回收、验收闭环和审计层**

换句话说：
- heartbeat 只负责认领，Publisher heartbeat 只负责超时扫描与验收
- executor 只做当前一棒
- session end 不直接等于 task complete
- `agent_end` 统一决定该 `next / complete / fail`
- Publisher 再决定 `close / reject / cancel`

---

## 本轮已对齐的文档事实

本轮代码与测试已明确覆盖这些行为：

- Publisher heartbeat 先做超时扫描，再做 completed 验收
- 超时判断口径以 `updatedAt > 1 小时` 为准
- 每次 heartbeat 最多处理 1 个超时任务；无超时任务时才验收 completed
- `mteam_close_task` 只允许关闭 `completed` 任务
- `mteam_reject_task` 会把任务打回 `pending`，并从驳回 reason 中解析新的 `nextDescription`
- `agent_end` 的主裁决由 `agentEndJudge`/LLM 提供；测试中应显式 stub，而不是依赖隐式默认行为

相关 e2e：
- `tests/e2e/publisher-acceptance-full-chain.e2e.test.ts`
- `tests/e2e/publisher-heartbeat-acceptance.e2e.test.ts`
- `tests/e2e/publisher-terminal-actions.e2e.test.ts`
- `tests/e2e/hook-runtime.e2e.test.ts`
- `tests/e2e/agent-end-llm-judge.e2e.test.ts`
- `tests/e2e/agent-end-observability.e2e.test.ts`

---

## 文档维护规则

- 不要把临时 bug 写成长期规范
- 不要让 patch 规则反向支配主架构
- 文档里的状态名、工具名、验收顺序必须与代码行为严格一致
- 一篇文档只回答一种问题，避免 README / 架构 / 流程 / 测试索引互相重复
- 如果实现存在历史残留与目标口径并存，要明确区分“当前真实运行态”与“历史文档口径”
- 自然语言测试文档如果仍沿用旧口径，必须显式标注，不可伪装成当前已对齐事实
