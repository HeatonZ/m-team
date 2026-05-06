# M-Team 任务看板 — 架构文档

## 1. 技术选型

| 层次 | 选型 | 理由 |
|------|------|------|
| 运行时 | Bun | 要求，快速启动 |
| 前端框架 | React 18 + TypeScript | 组件化、类型安全 |
| 构建工具 | Vite | 快速 HMR，与 Bun 兼容 |
| 后端 API | Node.js HTTP Server（现有 server.js） | 已实现，稳定 |
| 数据库 | SQLite（better-sqlite3） | m-team 已有，数据不动 |
| 测试 | Vitest | 与 Vite 生态集成 |
| UI | 纯 CSS（无框架）| 轻量，避免样式冲突 |

### 为什么不直接 import pool/db.js？

`better-sqlite3` 是 Native Module，无法在浏览器环境直接 import。Vite 的 Node.js 插件方案会增加复杂度。

**结论**：前端通过 REST API（server.js）与数据库交互，保持前后端分离。

---

## 2. 目录结构

```
m-team/dashboard/
├── server.js                  # HTTP API Server（现有，勿动）
│
├── src/                       # React 前端源码
│   ├── main.tsx               # React 入口
│   ├── App.tsx                # 根组件
│   ├── api/
│   │   └── client.ts          # API fetch 封装
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── TaskColumn.tsx
│   │   ├── HistoryTab.tsx
│   │   ├── TaskCard.tsx
│   │   └── TaskDetailModal.tsx
│   ├── hooks/
│   │   └── useTasks.ts
│   ├── types/
│   │   └── task.ts
│   └── utils/
│       └── format.ts
│
├── public/
│   └── index.html             # 保留（dev server fallback）
│
├── __tests__/
│   └── dashboard.test.js      # 现有集成测试（勿动）
│
├── docs/
│   ├── REQUIREMENTS.md
│   └── ARCHITECTURE.md
│
├── package.json               # React + Vite + Vitest 依赖
├── vite.config.ts             # Vite 配置（API proxy → server.js）
├── tsconfig.json
└── index.html                 # Vite 入口 HTML（替换 public/index.html 角色）
```

---

## 3. 技术方案详述

### 3.1 构建架构（Vite + Bun）

```
Development:
  bun run dev
    └── concurrently:
        ├── vite (port 5173)     ← 前端 HMR
        │     └── Proxy: /api/* → localhost:3000
        └── node server.js (port 3000) ← API

Production:
  bun run build
    └── vite build → dist/
  bun run start
    └── node server.js (port 3000) ← 同时服务静态文件
```

Vite 在开发模式通过 `serverProxy` 将 `/api` 请求代理到运行在 3000 端口的 server.js。在生产模式，Vite 构建产物由 server.js 通过静态文件中间件直接服务。

### 3.2 API 层（server.js）

server.js 是现有实现，担任 REST API 服务器角色，监听 3000 端口。

**API 契约**（现有，勿修改）：
- `GET /api/tasks/pending` → `{ tasks: Task[] }`
- `GET /api/tasks/running` → `{ tasks: Task[] }`
- `GET /api/tasks/history?status=X` → `{ tasks: Task[] }`
- `GET /api/tasks/:taskId` → `Task`（含完整 context）

server.js 通过 `dashboard/src/db.js` → `pool/db.js` 访问 SQLite 数据库。

### 3.3 前端状态管理

使用 React `useState` + `useEffect` + 自定义 hook `useTasks`：
- 每个 Tab 数据独立 fetch
- 15 秒轮询由 `setInterval` 驱动
- Modal 状态（选中 taskId）由 `App` 组件持有，通过 props 传递

### 3.4 样式方案

纯 CSS Modules 或普通 CSS 文件，无 CSS 框架。
样式与现有 `public/index.html` 的风格保持一致（深色主题，Twitter-like 配色）。

---

## 4. 数据模型（前端类型）

```typescript
// src/types/task.ts

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'high' | 'normal' | 'low';

export interface ContextInputEntry {
  type: 'input';
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ContextStepEntry {
  type?: string;
  executor: string;
  step: string;
  output?: {
    summary?: string;
    files?: string[];
  };
  completedAt?: number;
}

export type ContextEntry = ContextInputEntry | ContextStepEntry;

export interface Task {
  taskId: string;
  goal: string;
  description: string;
  context: ContextEntry[];
  priority: TaskPriority;
  status: TaskStatus;
  publisher: string;
  executor: string | null;
  lastExecutor: string | null;
  createdAt: number;
  completedAt: number | null;
  updatedAt: number;
}
```

---

## 5. API 代理配置（vite.config.ts）

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
  }
});
```

---

## 6. 测试方案

### 6.1 集成测试（现有）

测试文件：`__tests__/dashboard.test.js`
测试内容：
- pending 列表只含 pending 状态任务
- running 列表只含 running 状态任务
- 历史列表过滤（completed/failed）
- 任务详情读取（taskId + context 字段）
- 必填字段存在性

这些测试直接 import `dashboard/src/db.js`，不经过 HTTP 层。

### 6.2 测试运行

```bash
bun run test   # vitest run
bun run dev    # 并行启动 vite + server.js
```

---

## 7. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | API 服务器端口 |
| `WORKSPACE_ROOT` | `/mnt/d/code/m-team` | m-team 工作区根目录 |
| `VITE_API_BASE` | `/api` | 前端 API 前缀（Vite proxy） |

---

## 8. 已知约束

1. **Native Module**：better-sqlite3 无法在浏览器直接 import，前后端必须分离部署
2. **跨域**：生产模式 server.js 既是 API 服务器又是静态文件服务器，无跨域问题
3. **实时性**：轮询间隔 15 秒，不使用 WebSocket（任务池变更频率低）
