# M-Team 安装指南

> 版本：1.4 | 更新：2026-04-29

---

## 前提条件

- OpenClaw 已安装（`openclaw` CLI 可用）
- Node.js ≥ 18
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

这一步会装好 `better-sqlite3`，必须做。

### 3. 构建

```bash
npm run build
```

### 4. 添加到 plugins.allow

```bash
openclaw config set plugins.allow --array-add m-team
```

### 5. 在 plugins.entries 中添加配置

手动编辑 `~/.openclaw/openclaw.json`，在 `plugins.entries` 中加入：

```json
"m-team": {
  "enabled": true,
  "config": {
    "workspaceRoot": "~/.openclaw/m-team",
    "notifications": [
      {
        "provider": "feishu",
        "groupId": "oc_xxxxx",
        "appId": "cli_xxxx",
        "appSecret": "xxxx",
        "agents": ["manager", "maker", "fixer", "executor1", "executor2"]
      },
      {
        "provider": "discord",
        "channelId": "123456789",
        "discordToken": "Bot xxxx",
        "agents": ["manager", "maker", "fixer", "executor1", "executor2"]
      }
    ]
  }
}
```

### 6. 配置 HEARTBEAT.md（必须）

运行安装脚本，自动将心跳模板追加到各 agent workspace：

```bash
bash ~/code/m-team/scripts/install-heartbeat.sh
```

脚本会把 m-team 的心跳模板追加到以下 HEARTBEAT.md：
- `~/.openclaw/workspace-manager/HEARTBEAT.md`（Publisher 循环）
- `~/.openclaw/workspace-maker/HEARTBEAT.md`（Executor 循环）
- `~/.openclaw/workspace-fixer/HEARTBEAT.md`（Executor 循环）
- `~/.openclaw/workspace-scholar/HEARTBEAT.md`（Executor 循环）
- `~/.openclaw/workspace-captain/HEARTBEAT.md`（Executor 循环）

> 不会替换原有内容，只追加。重复运行会追加多次，可加 `--dry-run` 先预览。

### 7. 重启 Gateway

```bash
openclaw gateway restart
```

### 8. 验证插件加载

```bash
openclaw plugins list | grep m-team
```

状态显示 `enabled` 即成功。

---

## 开发工作流

每次修改源码后：

```bash
cd ~/code/m-team
npm run build
openclaw gateway restart
openclaw plugins list | grep m-team
```

---

## 目录结构

```
~/.openclaw/extensions/   # 插件加载目录
~/.openclaw/m-team/       # 工作区（运行时创建）
│   ├── tasks/
│   └── queue/
│       └── m-team.db
```
~/code/m-team/            # 插件源码
├── dist/                 # 构建产物
├── src/                  # 源码
├── skills/               # Skill 定义
│   ├── m-team-executor/
│   │   └── SKILL.md     # AI 执行手册
│   └── m-team-publisher/
│       └── SKILL.md     # AI 发布手册
├── templates/            # HEARTBEAT 模板（安装时追加到 workspace）
│   ├── HEARTBEAT-executor-fragment.md
│   └── HEARTBEAT-publisher-fragment.md
├── scripts/
│   └── install-heartbeat.sh  # HEARTBEAT 安装脚本
└── node_modules/         # 依赖
```

---

## 常见问题

**插件状态 error / Cannot find module 'better-sqlite3'**
```bash
cd ~/code/m-team && npm install && openclaw gateway restart
```

**Executor agent 不抢任务**
确认对应 workspace 的 HEARTBEAT.md 已追加 m-team 心跳循环，`mteam_claim_task` 和 `mteam_update_task` 工具已注册成功。

**通知没收到**
- 确认 `notifications[].agents` 列表包含执行者的 agentId
- 确认飞书群/Discord 频道 ID 正确
- 确认 OpenClaw 已配置对应渠道的 adapter
