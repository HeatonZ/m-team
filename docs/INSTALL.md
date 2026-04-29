# M-Team 安装指南

> 版本：1.0 | 更新：2026-04-29

---

## 前提条件

- OpenClaw 已安装（`openclaw` CLI 可用）
- Node.js ≥ 18（用于构建）
- OpenClaw Gateway 正在运行（`openclaw gateway status`）

---

## 安装步骤

### 1. 克隆仓库

```bash
git clone https://github.com/HeatonZ/m-team.git ~/code/m-team
cd ~/code/m-team
```

### 2. 安装依赖

```bash
npm install
```

### 3. 构建

```bash
npm run build
```

构建产物输出到 `dist/index.js`（约 134KB）。

---

## 配置 OpenClaw

### 4. 添加插件到 `plugins.allow`

```bash
openclaw config set plugins.allow --array-add m-team
```

或手动编辑 `~/.openclaw/openclaw.json`，在 `plugins.allow` 数组中加入 `"m-team"`。

### 5. 添加插件 entry 和通知配置

在 `~/.openclaw/openclaw.json` 的 `plugins.entries` 中添加：

```json
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
        "agents": ["manager", "maker", "fixer"]
      },
      {
        "provider": "discord",
        "channelId": "123456789",
        "agents": ["manager", "maker", "fixer"]
      }
    ]
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `workspace.root` | 工作区根目录，tasks/ 和 queue/ 建在此下 |
| `notifications` | 任务完成时通知（可选，支持 feishu/discord） |
| `notifications[].provider` | `feishu` 或 `discord` |
| `notifications[].groupId` / `channelId` | 飞书群 ID 或 Discord 频道 ID |
| `notifications[].agents` | 限定哪些 agent 完成时触发通知 |

### 6. 验证配置

```bash
openclaw config validate
```

### 7. 重启 Gateway

```bash
openclaw gateway restart
```

### 8. 验证插件加载

```bash
openclaw plugins list | grep m-team
```

输出包含 `enabled` 即为成功。

---

## 目录结构

```
~/code/m-team/           # 源码（git clone 位置）
├── dist/                # 构建产物（npm run build 生成）
├── src/                 # 源码
│   ├── index.js         # 插件入口
│   ├── pool/            # SQLite 任务池
│   ├── schema/          # Task 数据模型
│   ├── tools/           # 9 个工具注册
│   ├── hooks/           # subagent_ended hook
│   └── notifications.js # 通知格式化
├── skills/              # Skill 定义
│   ├── m-team-publisher/
│   └── m-team-executor/
└── openclaw.plugin.json # 插件元数据

~/.openclaw/extensions/  # OpenClaw 插件安装目录
└── m-team/             # 指向 ~/code/m-team（开发模式）

~/.openclaw/m-team/      # 工作区（运行时创建）
├── tasks/              # 任务产出目录
└── queue/
    └── m-team.db       # SQLite 数据库
```

---

## Skills 说明

插件自带两个 skill，会随插件自动加载：

| Skill | 触发场景 |
|-------|---------|
| `m-team-publisher` | 用户需要发布任务时 |
| `m-team-executor` | Agent 认领了任务后执行时 |

---

## 开发工作流

修改源码后，重新构建即可生效：

```bash
cd ~/code/m-team
npm run build        # 构建到 dist/
openclaw gateway restart
```

**不需要**每次都跑 `openclaw plugins install`，构建产物已经在正确路径。

---

## 常见问题

**插件不加载？**
```bash
openclaw plugins list | grep m-team   # 确认状态是 enabled
openclaw config validate              # 确认配置无语法错误
openclaw gateway restart               # 重启 Gateway
```

**通知没收到？**
- 确认 `notifications` 配置的 `agents` 列表包含执行者的 agentId
- 确认飞书群/Discord 频道 ID 正确
- 确认 OpenClaw 已配置对应渠道的 adapter

**任务一直 pending？**
- 检查心跳 session 是否正常运行（`openclaw sessions list`）
- 检查 `mteam_claim_task` 是否被正确调用
