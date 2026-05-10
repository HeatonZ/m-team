# M-Team 任务看板 — 需求文档

## 1. 产品概述

**产品名称**: M-Team Dashboard
**产品类型**: 内部任务链路看板（Web 应用）
**核心功能**: 以链式状态机视角展示任务接力、返工、收口与风险
**目标用户**: M-Team 成员（captain、maker、scholar 等 Agent）

---

## 2. 功能需求

### 2.1 链式任务主看板

| 区块 | 展示内容 | 数据依据 |
|------|----------|--------|
| 🆕 新任务 | `pending + phase=ready` | `GET /api/tasks/pending` |
| 🤝 等待下一棒 | `pending + phase=handoff` | `GET /api/tasks/pending` |
| 🛠️ 返工修正 | `pending + phase=reworking` | `GET /api/tasks/pending` |
| ⚙️ 执行中 | `running + phase=executing` | `GET /api/tasks/running` |
| ✨ 收口中 | `running + phase=finalizing` | `GET /api/tasks/running` |
| 🚨 风险雷达 | 疑似循环 / 无进展 / 重复 description | pending + running 聚合后前端计算 |

### 2.2 顶部总览区

展示聚合指标：
- 活跃任务数
- 等待交接数
- 返工中数
- 收口中数
- 风险任务数

### 2.3 筛选与热度

#### 风险筛选
- 全部
- 只看风险

#### 热度筛选（按 `updatedAt`）
- 全部
- 10 分钟内（fresh）
- 10-30 分钟（aging）
- 30 分钟以上（stale）

#### 任务热度带
按最近更新时间展示最多 12 个活跃任务：
- 蓝：新鲜
- 黄：变老
- 红：滞留
- 点击节点可打开任务详情

### 2.4 任务卡片

每张卡片至少展示：
- `taskType`
- `phase badge`
- `description`
- `goal`（弱化展示）
- 最新交接摘要（优先 `handoffNote`，其次 `summary` / `completionNote`）
- `publisher`
- `executor` 或 `lastExecutor`
- `handoffCount`
- `reworkCount`
- `updatedAt`
- freshness badge（新鲜 / 变老 / 滞留）
- 若存在风险，显示风险 badge：
  - 无进展
  - 重复描述
  - 停留过久

### 2.5 任务详情弹窗

弹窗需分块展示：

#### 当前状态
- `taskId`
- `taskType`
- `status`
- `phase`
- `priority`
- `publisher`
- `executor`
- `lastExecutor`
- `createdAt`
- `completedAt`
- `updatedAt`

#### 链式指标
- `handoffCount`
- `reworkCount`
- `lastDecision`
- `lastDecisionAt`

#### Loop Guard
- `samePhaseCount`
- `sameDescriptionCount`
- `noProgressCount`
- `lastProgressAt`

#### 最新交接摘要
- `handoffNote`
- `summary`
- `completionNote`
- `unresolvedIssues`
- `dataRefs`

#### Context 时间线
每步展示：
- `executor`
- `completedAt`
- `step`
- `output.summary`
- `output.handoffNote`
- `output.files`
- `output.metrics`

### 2.6 历史区

保留历史 Tab：
- completed
- closed
- failed
- cancelled

但卡片仍沿用新版 TaskCard 视觉，以便看到：
- 任务目标
- 最终摘要
- handoff/rework 次数
- 完成时间

---

## 3. 数据模型（前端视角）

```typescript
interface TaskLifecycle {
  phase: 'ready' | 'executing' | 'handoff' | 'reworking' | 'finalizing' | 'done';
  handoffCount: number;
  reworkCount: number;
  lastDecision?: 'retain' | 'relay' | 'complete' | 'fail';
  lastDecisionAt?: number;
  loopGuard: {
    samePhaseCount: number;
    sameDescriptionCount: number;
    noProgressCount: number;
    lastDescriptionFingerprint?: string;
    lastContextFingerprint?: string;
    lastProgressAt?: number;
  };
}

interface ContextStepOutput {
  summary?: string;
  files?: string[];
  dataRefs?: string[];
  completionNote?: string;
  handoffNote?: string;
  unresolvedIssues?: string[];
  error?: string;
  metrics?: Record<string, number | string>;
}
```

---

## 4. 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| R1 | 主看板按 phase 正确分组展示 | 视觉检查 + API 返回比对 |
| R2 | 风险雷达能显示疑似循环/无进展任务 | 构造数据 + 视觉检查 |
| R3 | 风险筛选与热度筛选可联动过滤任务 | 交互检查 |
| R4 | 热度带节点展示并可点击打开详情 | 交互检查 |
| R5 | 卡片展示 phase / freshness / handoff/rework 指标 | 视觉检查 |
| R6 | 弹窗展示 lifecycle / loopGuard / context 时间线 | 视觉检查 |
| R7 | dashboard build 通过 | `npm run build` |
