# M-Team Chain — 去中心化任务池协作

## 定位

OpenClaw 插件，实现 agent 间的去中心化任务协作。

## 目录结构

```
m-team/
├── index.js              # 插件入口
├── package.json          # npm 包定义
├── README.md             # 本文档
├── schema/
│   └── task.js          # 固定任务格式规范
├── queue/
│   └── index.js         # 任务池核心
└── skills/
    ├── task-publisher/  # 孔明用：发布任务
    └── task-worker/      # 执行者用：心跳认领+执行
```

## 安装

### 1. 安装插件

```bash
openclaw plugins install /mnt/d/code/m-team
```

或在 openclaw.json 配置：

```json
{
  "plugins": {
    "load": {
      "paths": ["/mnt/d/code/m-team"]
    },
    "entries": {
      "m-team": {
        "enabled": true,
        "config": {
          "workspaceRoot": "/mnt/d/code/m-team"
        }
      }
    }
  }
}
```

### 2. 配置每个 agent 的 HEARTBEAT.md

需要心跳检查任务池的 agent（captain/maker/scholar），在 HEARTBEAT.md 加入：

```markdown
## 任务池检查
- [ ] 检查 /mnt/d/code/m-team/queue/index.js 有无待认领任务
- [ ] 有则认领并执行
```

### 3. 孔明加载 task-publisher skill

孔明的 SOUL.md 或 AGENTS.md 中加载：

```
加载 skill: /mnt/d/code/m-team/skills/task-publisher/SKILL.md
```

### 4. 执行者加载 task-worker skill

captain/maker/scholar 的 SOUL.md 或 AGENTS.md 中加载：

```
加载 skill: /mnt/d/code/m-team/skills/task-worker/SKILL.md
```

## 配置

```json
{
  "workspaceRoot": "/mnt/d/code/m-team"
}
```

只需要配置 `workspaceRoot`，tasks 和 queue 目录自动创建在其下。

## 固定任务格式

```json
{
  "taskId": "task_1745620000000_abc123",
  "description": "搜索收纳箱供应商",
  "input": { "keyword": "收纳箱" },
  "requiredCapability": "captain",
  "initiator": "ceo",
  "status": "pending",
  "owner": null,
  "createdAt": 1745620000000,
  "claimedAt": null,
  "completedAt": null,
  "summary": null,
  "result": null
}
```

## 能力标签

| requiredCapability | 适用 agent |
|-------------------|-----------|
| captain | captain |
| maker | maker |
| scholar | scholar |
| general | 任意 |

## 使用流程

### 1. CEO 跟孔明确认需求

### 2. 孔明发布任务

```
加载 skill: /mnt/d/code/m-team/skills/task-publisher/SKILL.md
```

然后执行 publishTask。

### 3. agent 心跳认领

每个 agent 心跳时检查任务池，有任务就认领执行。

### 4. 群里回报

agent 完成后在群里发结果。

## 状态流转

```
pending → claimed → running → completed
                            → failed
```
