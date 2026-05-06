# M-Team 任务看板 — 需求文档

## 1. 产品概述

**产品名称**: M-Team Dashboard
**产品类型**: 内部任务管理看板（Web 应用）
**核心功能**: 实时展示 M-Team 任务池的任务状态，支持查看任务详情和历史记录
**目标用户**: M-Team 成员（captain、maker、scholar 等 Agent）

---

## 2. 功能需求

### 2.1 当前任务列表

| 区块 | 展示内容 | 数据源 |
|------|----------|--------|
| 待认领（pending） | 任务 description、优先级 badge、发布者 | `GET /api/tasks/pending` |
| 执行中（running） | 任务 goal、当前 executor、心跳时间 | `GET /api/tasks/running` |

- running 任务显示 `updatedAt`（格式：本地时间字符串）
- pending 任务按 priority 排序（high → normal → low）
- 数据每 15 秒自动刷新，支持手动刷新按钮

### 2.2 历史任务列表

| 区块 | 展示内容 | 数据源 |
|------|----------|--------|
| 完成（completed） | goal、完成时间、最终摘要 | `GET /api/tasks/history?status=completed` |
| 已验收（closed） | goal、验收时间、最终摘要 | `GET /api/tasks/history?status=closed` |
| 失败（failed） | goal、完成时间 | `GET /api/tasks/history?status=failed` |
| 已取消（cancelled） | goal、取消时间 | `GET /api/tasks/history?status=cancelled` |

- Tab 切换：✅完成 / 🔒已验收 / ❌失败 / 🚫已取消
- 每条记录显示完成时间（`completedAt` 格式化为本地时间）

### 2.3 任务详情

点击任意任务卡片，弹出 Modal 展示完整信息：

**基本信息字段**:
- `taskId` — 任务唯一 ID
- `goal` — 核心目标
- `description` — 当前步骤描述
- `status` — 状态（pending/running/completed/closed/failed/cancelled）
- `priority` — 优先级（high/normal/low）
- `publisher` — 发布者
- `executor` — 当前执行者（running 任务有值）
- `lastExecutor` — 上一步执行者
- `createdAt` — 创建时间
- `completedAt` — 完成时间
- `updatedAt` — 最后更新时间

**Context 步骤历史**（排除第 0 条 input）：
- 每步展示：`executor` | `step` 描述 | `completedAt` 时间
- `output.summary`（如果有）作为摘要展示
- 按时间顺序排列

### 2.4 看板界面布局

```
┌─────────────────────────────────────────────────┐
│  📊 m-team 任务看板              [🔄 刷新]      │
├─────────────────────────────────────────────────┤
│  ⏳ 待认领 (N)    │   ⚙️ 执行中 (N)              │
│  [卡片列表...]    │   [卡片列表...]              │
├─────────────────────────────────────────────────┤
│  📜 历史记录                                     │
│  [✅完成] [🔒已验收] [❌失败] [🚫已取消]            │
│  [卡片列表...]                                   │
└─────────────────────────────────────────────────┘
```

- Modal 详情层叠在列表之上，点击 backdrop 或 ✕ 关闭
- 响应式：窄屏下单列布局

---

## 3. 数据流设计

### 3.1 前端数据获取

```
React 组件 (useEffect/useState)
    │
    ▼
fetch('/api/tasks/pending')  ──►  Node.js server.js (REST API)
                                         │
                                         ▼
                                   dashboard/src/db.js
                                         │
                                         ▼
                                   pool/db.js (better-sqlite3)
                                         │
                                         ▼
                                   queue/m-team.db
```

### 3.2 API 端点

| 端点 | 方法 | 返回 |
|------|------|------|
| `/api/tasks/pending` | GET | `{ tasks: Task[] }` |
| `/api/tasks/running` | GET | `{ tasks: Task[] }` |
| `/api/tasks/history?status=completed\|closed\|failed\|cancelled` | GET | `{ tasks: Task[] }` |
| `/api/tasks/:taskId` | GET | `Task` 完整对象（含 context） |

### 3.3 Task 数据模型（前端视角）

```typescript
interface Task {
  taskId: string;           // e.g. "task_1745991234"
  goal: string;              // 核心目标
  description: string;      // 当前步骤描述
  context: ContextEntry[];   // 执行上下文
  priority: 'high' | 'normal' | 'low';
  status: 'pending' | 'running' | 'completed' | 'closed' | 'failed' | 'cancelled';
  publisher: string;
  executor: string | null;   // 当前执行者
  lastExecutor: string | null;
  createdAt: number;         // Unix ms
  completedAt: number | null;
  updatedAt: number;
}

interface ContextEntry {
  type: 'input';
  data: object;
  createdAt: number;
  // 或
  type?: string;
  executor: string;
  step: string;
  output?: {
    summary?: string;
    files?: string[];
  };
  completedAt: number;
}
```

---

## 4. 组件结构

```
src/
├── App.tsx                    # 根组件，Tab 状态管理
├── components/
│   ├── Header.tsx             # 标题栏 + 刷新按钮
│   ├── TaskColumn.tsx         # 任务列（pending/running）
│   ├── HistoryTab.tsx         # 历史 Tab 切换
│   ├── TaskCard.tsx           # 单个任务卡片
│   └── TaskDetailModal.tsx    # 任务详情 Modal
├── hooks/
│   └── useTasks.ts            # 任务数据 fetch hook
├── api/
│   └── client.ts              # API 封装（fetch 包装）
└── utils/
    └── format.ts              # 时间格式化、状态 label 工具
```

---

## 5. 验收标准

| ID | 标准 | 验证方式 |
|----|------|----------|
| R1 | pending 列表展示待认领任务，按优先级排序 | 视觉检查 + API 调用 |
| R2 | running 列表展示执行中任务，显示 executor 和心跳时间 | 视觉检查 + API 调用 |
| R3 | 历史 Tab 切换正常，completed/failed/cancelled 分别展示 | 视觉检查 |
| R4 | 点击任务卡片弹出 Modal，展示所有字段 | 视觉检查 |
| R5 | Modal 展示 context 步骤历史（排除 input entry） | 视觉检查 |
| R6 | 数据 15 秒自动刷新，手动刷新有效 | 观察 Network |
| R7 | 窄屏下布局为单列 | 浏览器响应式测试 |
| R8 | `bun run test` 全部通过 | CI |
| R9 | `bun run dev` 正常启动，数据正常加载 | 浏览器访问 localhost:3000 |
