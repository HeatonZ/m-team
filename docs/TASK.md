# M-Team — 任务格式与 Tool API

> 版本：4.0 | 更新：2026-05-09
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[SESSION.md](./SESSION.md)

---

## 任务格式

```json
{
  "taskId": "task_1745620000",
  "taskType": "research",
  "description": "基于上一步生成的 suppliers_001.json，联系候选供应商确认价格，并补写回复结果到 result.json，至少覆盖 5 家",
  "goal": "找到收纳箱类目下评分高且价格可确认的1688供应商",
  "context": [
    {
      "type": "step",
      "executor": "agent_1",
      "step": "搜索1688供应商",
      "output": {
        "summary": "找到10家候选供应商",
        "files": ["data/suppliers_001.json"],
        "dataRefs": ["suppliers_001.json"],
        "handoffNote": "下一棒基于 suppliers_001.json 联系候选供应商确认价格"
      },
      "completedAt": 1745621000000
    }
  ],
  "lifecycle": {
    "phase": "handoff",
    "handoffCount": 1,
    "reworkCount": 0,
    "lastDecision": "relay",
    "lastDecisionAt": 1745621000000,
    "loopGuard": {
      "samePhaseCount": 1,
      "sameDescriptionCount": 1,
      "noProgressCount": 0,
      "lastDescriptionFingerprint": "基于上一步生成的suppliers001json联系候选供应商确认价格并补写回复结果到resultjson至少覆盖5家",
      "lastContextFingerprint": "{\"summary\":\"找到10家候选供应商\",\"files\":[\"data/suppliers_001.json\"]}",
      "lastProgressAt": 1745621000000
    }
  },
  "priority": "high",
  "publisher": "user",
  "status": "pending",
  "executor": null,
  "lastExecutor": "agent_1",
  "createdAt": 1745620000000,
  "completedAt": null,
  "updatedAt": 1745621000000
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskId` | string | 唯一标识，格式 `task_{Date.now()}`（毫秒级） |
| `taskType` | string | 任务类型：`general` / `coding` / `research` / `ops` / `data` / `design` / `content` |
| `description` | string | **当前一棒唯一执行指令**，每次 relay 后更新 |
| `goal` | string | **终态标尺**，创建后不可更改 |
| `context` | array | 已完成步骤历史，数组末尾是最新交接结果 |
| `lifecycle` | object | 链式状态机内部状态，包含 `phase`、handoff/rework 计数与 loopGuard |
| `priority` | string | `high` / `normal` / `low` |
| `publisher` | string | 发布者身份 |
| `status` | string | `pending` / `running` / `completed` / `closed` / `failed` / `cancelled` |
| `executor` | string\|null | 当前持有任务的 agentId |
| `lastExecutor` | string\|null | 上一个 executor（handoff/rework 时传承） |
| `createdAt` | number | 创建时间戳（毫秒） |
| `completedAt` | number\|null | 完成时间戳 |
| `updatedAt` | number | 最后更新时间戳 |

### context 格式说明

`context` 只保留真正的执行历史 step，不再保留 `input` 头节点。

| 字段 | 说明 |
|------|------|
| `context[].type` | 固定为 `step` |
| `context[].executor` | 执行该步骤的 agentId |
| `context[].step` | 该步实际执行动作 |
| `context[].output.summary` | 步骤摘要 |
| `context[].output.files` | 产出文件路径 |
| `context[].output.dataRefs` | 下一棒可直接依赖的数据引用 |
| `context[].output.handoffNote` | 给下一棒的接续说明 |
| `context[].output.unresolvedIssues` | 尚未解决的问题 |
| `context[].output.metrics` | 结构化指标（数量、命中数等） |
| `context[].completedAt` | 步骤完成时间戳 |

### lifecycle.phase 语义

| phase | 对应 status | 含义 |
|------|-------------|------|
| `ready` | `pending` | 新任务待认领 |
| `executing` | `running` | 当前 executor 正在执行 |
| `handoff` | `pending` | 上一棒已完成，等待下一棒接手 |
| `reworking` | `pending` | 需要返工修正，等待下一棒纠偏 |
| `finalizing` | `running` | 已接近完成，当前 executor 正在收口 |
| `done` | `completed` / `closed` | 已完成，等待验收或已关闭 |

### 状态流转

```text
pending + ready/handoff/reworking
  └─ claim ─→ running + executing

running + executing
  ├─ 当前棒完成但任务未结束 ─→ pending + handoff
  ├─ 当前棒发现问题需纠偏 ─→ pending + reworking
  ├─ 已接近结束需收口 ─→ running + finalizing
  ├─ goal 已达成 ─→ completed + done
  └─ 不可恢复失败 ─→ failed

running + finalizing
  ├─ 收口完成 ─→ completed + done
  ├─ 发现问题需返工 ─→ pending + reworking
  ├─ 仍需下一棒补一小步 ─→ pending + handoff
  └─ 不可恢复失败 ─→ failed
```

---

## Tool API（10 个）

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改；可显式传 `taskType` 供 heartbeat 粗筛） |
| `mteam_claim_task` | 执行者 | 认领任务（SQLite 事务，原子操作） |
| `mteam_reject_task` | Publisher | 验收不通过，驳回任务到 pending |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | Publisher/运维 | 回收卡死任务，放回 pending |
| `mteam_get_pending` | 执行者 | 获取待认领任务（agent 有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_close_task` | Publisher | Publisher 验收通过，关闭任务（终态） |
| `mteam_get_all_tasks` | 执行者 | 获取所有任务 |

> **注意**：`complete_task`、`relay_task`、`update_task` 已移除。executor 执行完后不调用任何管理工具，complete / relay / fail / retain 由 `agent_end` hook 在执行轮结束时自动判断并执行。

---

## mteam_claim_task

认领一个 `pending + ready/handoff/reworking` 任务，同时在 Plugin 内部创建 Executor Session。

```javascript
mteam_claim_task({
  taskId: "task_1745740800",
  agentId: "my-agent-id"
})
```

**executor 执行完后不调用任何工具**，直接结束 session。后续 complete / relay / fail / retain 由 `agent_end` hook 处理。

### retain 说明

retain 不是新的对外 status，而是链式任务里的**例外路径**：

- **主路径**：`executing -> handoff/reworking -> executing -> finalizing -> done`
- **retain**：控制权继续留在当前 executor，常见于：
  - 当前一棒尚未真正结束，但已有明确中间进展
  - 当前 executor 正在 `finalizing` 收口

因此“未完成”不一定等于“放回池子”，但默认优先 handoff / reworking，而不是 retain。

---

## mteam_reject_task

Publisher 验收不通过，驳回任务到 `pending` 池子。

```javascript
mteam_reject_task({
  taskId: "task_xxx",
  reason: "验收驳回：仅找到1个符合条件商品，要求5个。下一步：继续搜索宠物玩具关键词，筛选 costPrice ≤ 5 RMB、规格数 ≤ 8，找够剩余 4 个"
})
```

**驳回原因必须包含两部分**：
1. **问题**：具体哪里不对
2. **下一步**：下一棒要做什么（动作 + 目标 + 条件 + 完成标准）

---

## mteam_relinquish_task

`mteam_relinquish_task` 只保留给 Publisher 超时回收或人工运维回收。正常 executor 不应主动调用。

---

## 查询类工具

```javascript
mteam_get_pending({ agentId: "my-agent" })
// 返回: { pending: [{ taskId, taskType, description, context, lifecycle, priority, ... }] }

mteam_get_agent_active({ agentId: "my-agent" })

mteam_get_task({ taskId: "task_xxx" })

mteam_get_all_tasks({})
```

**认领时主要看**：`taskType`、`description`、已有 `context`。`goal` 仅用于复盘和验收。

---

## mteam_close_task

Publisher 验收 Executor 完成的任务。通过后任务进入 `closed` 终态。

```javascript
mteam_close_task({
  taskId: "task_xxx",
  publisher: "user"
})
```

---

## 并发竞态保护

`claimTask` 使用 SQLite 事务，保证同一任务只能被一个 agent 成功认领。
