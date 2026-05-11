# 测试用例文档

> 当前测试用例文档**仍有一部分沿用旧的 phase-heavy 口径**。请不要把本目录直接当成“已完全对齐当前代码”的事实来源。

## 当前状态说明

目前仓库里存在两层测试资产：

1. **自然语言测试用例文档**（本目录 `TC-*.md`）
2. **真实 e2e 自动化测试**（`tests/e2e/*.test.ts`）

其中：
- 自动化 e2e 已经对齐当前高风险边界，尤其是 `agent_end` 主裁决、Publisher heartbeat 超时优先、completed→close/reject 闭环
- 多数 `TC-*.md` 仍保留较重的 phase / 状态机口径，部分内容与当前实现关注点并不完全一致

所以当前正确用法是：

> **TC 文档用于梳理业务边界与历史覆盖面；是否已被当前代码严格实现，要再对照对应 e2e。**

---

## 模块索引

| 模块编号 | 文件 | 新名称 | 备注 |
|------|------|------|------|
| M1 | [TC-A.md](./TC-A.md) | 链式正常流转 | 仍偏 phase-heavy，需要后续收敛 |
| M2 | [TC-B.md](./TC-B.md) | 交接与返工 | 需复核是否与当前 `handoff/reworking` 行为一致 |
| M3 | [TC-C.md](./TC-C.md) | 失败与熔断 | 需对照当前 `agent_end` fallback/fail 逻辑 |
| M4 | [TC-D.md](./TC-D.md) | 取消与终态保护 | 需对照当前权限与终态约束 |
| M5 | [TC-E.md](./TC-E.md) | 回池与回收 | 与 Publisher timeout 有关，建议优先更新 |
| M6 | [TC-F.md](./TC-F.md) | 已取消任务保护 | 需复核 |
| M7 | [TC-G.md](./TC-G.md) | 并发与占用 | 需复核 |
| M8 | [TC-H.md](./TC-H.md) | 守卫顺序 | 需对照 `sessionGuard` 当前行为 |
| M9 | [TC-I.md](./TC-I.md) | 持久化一致性 | 需对照 `task/context/lifecycle` 当前落盘结构 |
| M10 | [TC-J.md](./TC-J.md) | 排队与优先级 | 仍大量引用旧 pending phase 口径 |
| M11 | [TC-K.md](./TC-K.md) | 底层存储映射 | 需复核 |
| M12 | [TC-L.md](./TC-L.md) | 查询与看板数据 | 仍引用旧 phase 细节，需要收敛 |

---

## 当前已明确对齐的自动化测试主题

以下主题已被当前 e2e 明确覆盖，可作为优先可信的验收基线：

### 1. `agent_end` 主裁决边界
- `tests/e2e/agent-end-llm-judge.e2e.test.ts`
- `tests/e2e/agent-end-phase2-observability.e2e.test.ts`
- `tests/e2e/hook-lifecycle.e2e.test.ts`

覆盖点：
- relay / retain / complete / fail
- fallback 的保守行为
- relay 后 description 切换
- complete 不再依赖 executor 口头成功

### 2. Publisher heartbeat 超时优先
- `tests/e2e/publisher-heartbeat-acceptance.e2e.test.ts`
- `tests/e2e/publisher-acceptance-full-chain.e2e.test.ts`

覆盖点：
- heartbeat 先检查 running timeout
- timeout 口径以 `updatedAt > 1 小时`
- 每次 heartbeat 最多处理 1 个 timeout
- 无 timeout 时才进入 completed 验收

### 3. Publisher 验收闭环
- `tests/e2e/publisher-terminal-actions.e2e.test.ts`
- `tests/e2e/publisher-acceptance-full-chain.e2e.test.ts`

覆盖点：
- completed → close → closed
- completed → reject → pending
- reject reason 解析出下一步 description
- 非 Publisher 不得执行 close / reject / cancel

### 4. 会话与权限边界
- `tests/e2e/hook-lifecycle.e2e.test.ts`
- `tests/e2e/publisher-terminal-actions.e2e.test.ts`

覆盖点：
- heartbeat 不执行任务
- heartbeat 不越权 spawn / send
- executor 不能主动 relinquish / close
- Publisher 才能做验收终态动作

---

## 编写原则

- 用自然语言描述，不写测试代码
- 先写业务期望，再写验证点
- 优先围绕稳定边界写，而不是围绕内部实现细节写
- 文档中的动作名、字段名、状态名、phase 名必须与当前代码行为严格一致
- 若某条用例仍是历史口径，必须显式标注“待对齐”，不能伪装成当前事实

---

## 后续文档整理建议

下一轮建议优先处理：

1. **先改 TC-E**：把 Publisher timeout / acceptance 顺序写准确
2. **再改 TC-A / TC-B**：把 full-chain relay / reworking / close/reject 主路径对齐当前代码
3. **再改 TC-L / TC-J**：清理旧查询口径和 pending phase 排队叙述
4. **最后统一过一轮术语**：
   - `status`
   - `lifecycle.phase`
   - `agent_end` 裁决
   - `Publisher acceptance`

---

## 运行说明

当前仓库不应再以“TC 文档本身已经完全正确”为前提。

更稳妥的方式是：

1. 先以 `docs/ARCHITECTURE.md` / `docs/SESSION.md` 作为主口径
2. 再以 `tests/e2e/*.test.ts` 验证真实边界
3. 最后逐步把 `TC-*.md` 收敛到当前实现
