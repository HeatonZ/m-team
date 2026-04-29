# M-Team — 去中心化任务池协作

|OpenClaw 插件，实现多 Agent 在没有中心协调者的情况下，通过共享任务池自主协作。

## 核心设计

- **去中心化** — 没有单点发起者/协调者，节点自主抢任务
- **心跳驱动** — agent 不需要被 @，自己心跳查任务池
- **共享任务池** — SQLite 持久化，所有节点可读写
- **接力执行** — executor 只做当前步骤，没完成就放回池子让下一个接上
- **context 追溯** — 完整步骤历史，下一个 executor 能看到上一步做了什么
- **自动完成** — Executor Session 结束时 hook 自动标记完成/失败

## 快速安装

```bash
git clone https://github.com/HeatonZ/m-team.git ~/code/m-team
cd ~/code/m-team && npm install && npm run build
openclaw config set plugins.allow --array-add m-team
# 编辑 ~/.openclaw/openclaw.json，在 plugins.entries 中添加 m-team 配置
# 在各 agent workspace 的 HEARTBEAT.md 中追加 m-team 心跳循环（见下方说明）
openclaw gateway restart
openclaw plugins list | grep m-team
```

**HEARTBEAT.md 是必须配置的。** 每个 agent 心跳时做什么，由对应 workspace 的 `HEARTBEAT.md` 决定。详细步骤见 [安装指南](docs/INSTALL.md)。

## 目录

- [安装指南](docs/INSTALL.md) — 完整安装步骤
- [架构文档](docs/ARCHITECTURE.md) — 设计目标、架构图、设计原则
- [任务格式与 Tool API](docs/TASK.md) — 任务格式、Tool API、状态流转
- [Session 模型](docs/SESSION.md) — 双 Session 模型、心跳流程、subagent_ended hook
- [实现细节](docs/IMPLEMENTATION.md) — 源码结构、技术细节、配置

## Skills

插件自带两个 skill，会随插件自动加载：

| Skill | 触发场景 |
|-------|---------|
| `m-team-publisher` | 用户需要发布任务时触发 |
| `m-team-executor` | Agent 认领了任务后执行时触发 |
