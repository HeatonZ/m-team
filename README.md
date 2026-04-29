# M-Team — 去中心化任务池协作

OpenClaw 插件，实现多 Agent 在没有中心协调者的情况下，通过共享任务池自主协作。

## 核心设计

- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — SQLite 持久化，所有节点可读写
- **接力执行** — executor 只做当前步骤，没完成就放回池子让下一个接上
- **context 追溯** — 完整步骤历史，下一个 executor 能看到上一步做了什么

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
          "workspace": {
            "root": "/home/hjl/.openclaw/m-team"
          },
          "notifications": [
            {
              "provider": "feishu",
              "groupId": "oc_xxxxx",
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
| `workspace.root` | 工作区根目录，tasks/ 和 queue/ 建在此下 |
| `notifications` | 任务完成时通知（可选，支持 feishu / discord）|

## 目录结构

```
src/
├── index.js              # 插件入口（register + 重新导出）
├── pool/
│   ├── db.js            # SQLite 持久化层（含序列化）
│   ├── index.js         # 对外只读 API（查询 + 通知格式化）
│   └── operations.js    # 所有写操作
├── schema/
│   └── task.js          # Task 数据模型 + 验证
├── tools/
│   ├── index.js         # 全部 9 个工具注册
│   └── helpers.js       # 参数读取 / jsonResult 封装
└── hooks/
    └── subagentEnded.js # subagent_ended hook 自动完成任务/失败
```

构建产物在 `dist/`，由 `npm run build` 生成。

## Tool API（9 个）

| Tool | 调用者 | 说明 |
|------|--------|------|
| `mteam_publish_task` | 管理者 | 发布新任务（goal 必填，不可更改） |
| `mteam_claim_task` | 执行者 | 认领任务（原子操作，防并发竞态） |
| `mteam_update_task` | 执行者 | 更新状态/追加 context 步骤 |
| `mteam_cancel_task` | 管理者 | Publisher 取消任务（不可再 relay） |
| `mteam_relinquish_task` | 执行者 | Executor 主动放弃当前任务（放回 pending） |
| `mteam_get_pending` | 执行者 | 获取待认领任务列表（agent 有任务时返回空） |
| `mteam_get_agent_active` | 执行者 | 获取 agent 当前进行中任务 |
| `mteam_get_task` | 执行者 | 获取任务详情 |
| `mteam_get_all_tasks` | 执行者 | 获取所有任务 |

## 任务格式

```json
{
  "taskId": "task_1745620000000_abc123",
  "description": "联系供应商确认价格",
  "goal": "找到收纳箱类目下评分高的1688供应商",
  "context": [
    { "type": "input", "data": { "keyword": "收纳箱", "count": 10 }, "createdAt": 1745620000000 },
    { "executor": "agent_1", "step": "搜索1688供应商", "output": { "summary": "找到10家供应商", "files": ["data/suppliers_001.json"] }, "completedAt": 1745621000000 },
    { "executor": "agent_2", "step": "联系供应商确认价格", "output": { "summary": "联系了5家，3家回复" }, "completedAt": 1745622000000 }
  ],
  "priority": "high",
  "publisher": "user",
  "status": "pending",
  "executor": null,
  "lastExecutor": "agent_2",
  "createdAt": 1745620000000,
  "completedAt": null,
  "lastHeartbeatAt": null
}
```

### context 格式说明

- **第一个 entry**：`type: "input"` 标记的原始输入，创建后不可更改
- **后续 entries**：每步执行后追加 `{ executor, step, output }`
- **output.summary**：executor 自己填，建议简洁
- **output.files**：只存任务文件夹内的相对路径，原始数据放文件里

## 状态流转

```
pending → running → completed
                        ↘ failed
                        ↘ pending（需接力，taskId 不变）
```

## 双 Session 模型

M-Team 使用两个独立的 OpenClaw Session：

| Session | 创建方式 | 用途 | 生命周期 |
|---------|----------|------|----------|
| **Heartbeat Session** | HEARTBEAT 模板驱动 | 轮询任务池、维护心跳、认领任务 | 长期运行 |
| **Executor Session** | `mteam_claim_task` 内部创建 | 实际执行任务 | 任务级 |

**自动完成**：Executor Session 结束时（`outcome=ok`/`reset`），`subagent_ended` hook 自动调用 `completeTask`；异常结束时自动调用 `failTask`。无需 executor 手动调工具。

## 开发

```bash
npm run build    # 构建到 dist/
npm run test     # Vitest watch 模式
npm run test:run # Vitest 单次运行
```

**重要：开发代码在 `/mnt/d/code/m-team`，构建在 `~/code/m-team`**，不要直接改 `~/.openclaw/extensions/m-team/` 下的文件。
