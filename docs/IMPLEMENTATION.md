# M-Team — 源码结构与技术细节

> 版本：2.0 | 更新：2026-04-29
> 参考：[ARCHITECTURE.md](./ARCHITECTURE.md)、[TASK.md](./TASK.md)

---

## 源码结构

```
src/
├── index.js               # 插件入口（register + 重新导出）
│
├── pool/
│   ├── db.js             # SQLite 连接 + tasks 表初始化 + 序列化
│   ├── index.js          # 对外只读 API（查询 + 通知格式化）
│   └── operations.js     # 所有写操作
│
├── schema/
│   └── task.js           # Task 模型 + 验证 + 格式化（纯函数）
│
├── tools/
│   ├── index.js          # 全部 9 个工具注册（Typebox schema）
│   └── helpers.js        # 参数读取 / jsonResult 封装
│
└── hooks/
    └── subagentEnded.js  # subagent_ended hook 处理器
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `pool/db.js` | SQLite 连接、tasks 表初始化、CRUD helpers、task ↔ row 序列化 |
| `pool/operations.js` | 所有写操作（publish/claim/update/cancel/relinquish/complete/fail）|
| `pool/index.js` | 只读查询（getPending/getTask/getAllTasks/formatNotifications）|
| `schema/task.js` | Task 模型定义、createTask、validateTask、格式化输出（纯函数，可单元测试）|
| `tools/index.js` | 9 个工具的 Typebox 参数定义 + execute 实现 |
| `tools/helpers.js` | readStr/readNum/jsonResult 等工具函数 |
| `hooks/subagentEnded.js` | subagent_ended hook，自动 complete/fail 任务 |

---

## 运行时数据流

```
src/index.js (register)
     │
     ├─ registerTools(api, config)
     │       └─ tools/index.js
     │               └─ 调用 pool/operations.js 写操作
     │                       └─ pool/db.js (SQLite)
     │
     └─ registerSubagentEndedHook(api)
             └─ hooks/subagentEnded.js
                     └─ 调用 pool/operations.js completeTask/failTask
                             └─ pool/db.js (SQLite)
```

---

## 数据库 Schema

tasks 表：

```sql
CREATE TABLE tasks (
  task_id        TEXT PRIMARY KEY,
  description    TEXT NOT NULL,
  goal           TEXT NOT NULL,
  context        TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  priority       TEXT NOT NULL DEFAULT 'normal',
  publisher      TEXT NOT NULL DEFAULT 'user',
  status         TEXT NOT NULL DEFAULT 'pending',
  executor       TEXT,
  last_executor  TEXT,
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  last_heartbeat_at INTEGER
);

CREATE INDEX idx_tasks_status      ON tasks(status);
CREATE INDEX idx_tasks_executor   ON tasks(executor);
CREATE INDEX idx_tasks_priority   ON tasks(priority);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
```

**存储约定**：
- `context` 字段存 JSON 字符串，读写时自动序列化
- 所有时间存毫秒时间戳（integer）
- `task_id` 是主键，所有关联通过 task_id

---

## 构建

```bash
npm run build    # esbuild bundle 到 dist/index.js
```

esbuild 配置：
- `platform=node` + `format=esm`
- `external: node:* / openclaw / openclaw/plugin-sdk`
- bundle 大小约 122KB（含 @sinclair/typebox runtime）

---

## 测试

```bash
npm run test     # watch 模式
npm run test:run # 单次运行
```

当前测试覆盖：`src/schema/task.js` 纯函数（createTask / validateTask / format*）。

---

## 配置文件

`openclaw.json` 中的插件配置：

```json
{
  "plugins": {
    "entries": {
      "m-team": {
        "enabled": true,
        "config": {
          "workspace": {
            "root": "/home/hjl/.openclaw/m-team"
          },
          "notifications": [
            {
              "provider": "feishu",
              "groupId": "oc_xxxxx",
              "appId": "cli_xxxx",
              "appSecret": "xxxx",
              "agents": ["agent_1", "agent_2"]
            },
            {
              "provider": "discord",
              "channelId": "123456",
              "discordToken": "Bot xxxx",
              "agents": ["agent_1", "agent_2"]
            }
          ]
        }
      }
    }
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `workspaceRoot` | 工作区根目录，tasks/ 和 queue/ 建在此下 |
| `notifications` | 任务状态变更时通知（publish / claim / complete / relay / relinquish / cancel）|
| `notifications[].agents` | 限定特定 agent 触发通知（publisher/executor 匹配才发）。通常填入所有需要接收通知的 agentId，如 `["manager", "maker", "executor1"]`，配置一个账号即可覆盖全队 |
| `notifications[].appId` | Feishu 机器人的 app_id（provider=feishu 时必填） |
| `notifications[].appSecret` | Feishu 机器人的 app_secret（provider=feishu 时必填） |
| `notifications[].discordToken` | Discord 机器人的 bot token（provider=discord 时必填） |

---

## 安装路径

- **WSL 开发路径**：`/mnt/d/code/m-team/`（权限干净）
- **OpenClaw 安装路径**：`~/.openclaw/extensions/m-team/`（由 `openclaw plugins install` 管理）
- **工作目录**：`/home/hjl/.openclaw/m-team/`（tasks/ 和 queue/ 在此）

**重要：开发代码在 `/mnt/d/code/m-team`，不要直接改 `~/.openclaw/extensions/m-team/`**

安装步骤：
```bash
npm install && npm run build
openclaw plugins install ~/code/m-team --force
openclaw gateway restart
```

---

## 工作区目录结构

```
workspaceRoot/
├── tasks/
│   └── {taskId}/
│       ├── task.json            ← 任务详情（同步写入，外部可直接读）
│       └── {产出文件}          ← executor 写入的任务文件夹
└── queue/
    └── m-team.db               ← SQLite 数据库（唯一真实数据源）
```

**数据源优先级**：SQLite tasks 表 > task.json 文件。task.json 是为了让外部工具（如 cat、grep）能直接读取引用，不做为主数据源。
