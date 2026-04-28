# M-Team — 去中心化任务池协作

OpenClaw 插件，实现多 Agent（孔明/captain/maker/scholar）在没有中心协调者的情况下，通过共享任务池自主协作。

## 核心设计

- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — 任务池是文件系统中的 JSON 队列，所有节点可读写

## 快速安装

```bash
# 1. 构建
npm install && npm run build

# 2. 安装插件（指定 WSL 原生路径，避免 NTFS 权限问题）
openclaw plugins install ~/code/m-team --force

# 3. 重启 Gateway
openclaw gateway restart
```

## 配置

`openclaw.json` 中的插件配置：

```json
{
  "plugins": {
    "entries": {
      "m-team": {
        "enabled": true,
        "config": {
          "workspaceRoot": "/home/hjl/.openclaw/m-team"
        }
      }
    }
  }
}
```

`workspaceRoot` 是唯一可配置项，tasks 和 queue 目录自动创建在其下。

## 目录结构

```
m-team/
├── src/
│   ├── index.js              # 插件入口（注册 7 个 tools）
│   ├── schema/
│   │   ├── task.js           # 任务格式定义 + 验证工具
│   │   └── task.test.js      # Vitest 单元测试（25 个用例）
│   └── queue/
│       └── index.js          # 任务池核心操作
├── skills/
│   ├── m-team/               # 主 skill：工具说明 + 执行流程
│   └── mteam-task-health/    # 心跳健康检查 skill
├── dist/                     # 构建产物（npm run build 生成）
├── openclaw.plugin.json       # 插件元数据
├── package.json
├── vitest.config.js          # Vitest 测试配置
└── docs/
    └── ARCHITECTURE.md       # 详细架构文档
```

## Tool API

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 孔明 | 发布新任务 |
| `mteam_claim_task` | 执行者 | 认领任务（原子操作，防并发） |
| `mteam_update_task` | 执行者 | 更新状态/心跳 |
| `mteam_get_pending` | 执行者 | 获取待认领任务列表 |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 任意 | 获取任务详情 |
| `mteam_get_all_tasks` | 任意 | 获取所有任务 |

## 任务格式

```json
{
  "taskId": "task_1745620000000_abc123",
  "description": "搜索收纳箱供应商",
  "input": { "keyword": "收纳箱" },
  "requiredCapability": "captain",
  "priority": "high",
  "initiator": "ceo",
  "status": "pending",
  "owner": null,
  "createdAt": 1745620000000,
  "claimedAt": null,
  "completedAt": null,
  "lastHeartbeatAt": null,
  "summary": null,
  "result": null
}
```

## 状态流转

```
pending → claimed → running → completed
                          ↘ failed
                          ↘ pending（需下一步，taskId 不变）
```

## 开发

```bash
npm run build    # 构建到 dist/
npm run test     # Vitest watch 模式
npm run test:run # Vitest 单次运行
```

**重要：开发代码在 `/mnt/d/code/m-team`，构建在 `~/code/m-team`**，不要直接改 `~/.openclaw/extensions/m-team/` 下的文件。

## 测试

```
25 个单元测试，覆盖 src/schema/task.js 纯函数：
- createTask / validateTask
- getStatusLabel / getTaskSummary / formatTaskForHuman
- getTaskWorkspace / ensureTaskWorkspace
```
