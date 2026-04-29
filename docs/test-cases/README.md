# 测试用例文档

> 按业务流程模块划分的端到端闭环测试用例。

## 模块索引

| 模块 | 文件 | 内容 |
|------|------|------|
| 正常完成 | [TC-A.md](./TC-A.md) | Happy Path，含心跳保活、快速完成 |
| 中转交接 | [TC-B.md](./TC-B.md) | 单次 Relay、多次 Relay、旧 Session Graceful |
| 任务失败 | [TC-C.md](./TC-C.md) | fail 标记、重复 fail、未开始直接 fail |
| 取消任务 | [TC-D.md](./TC-D.md) | Cancel Running、非 Publisher Cancel、Cancel PENDING、终态重复取消、Relay 后取消 |
| 放弃任务 | [TC-E.md](./TC-E.md) | Relinquish 后他人完成、非 Executor 放弃、CANCELLED 不可放弃 |
| Cancelled 宽容处理 | [TC-F.md](./TC-F.md) | 允许追加 Context、拒绝 Relay、拒绝 Complete |
| 并发场景 | [TC-G.md](./TC-G.md) | 同时认领同一任务、Agent 已有活跃任务 |
| 守卫顺序验证 | [TC-H.md](./TC-H.md) | relayTask/relinquishTask Bug 验证 |
| 文件系统持久化 | [TC-I.md](./TC-I.md) | publishTask、relayTask、updateTask 同步写 task.json |
| 优先级调度 | [TC-J.md](./TC-J.md) | 高优先级优先、同优先级 FIFO |
| db.js 底层 | [TC-K.md](./TC-K.md) | 序列化、字段映射、单例、closeDb |
| 读 API | [TC-L.md](./TC-L.md) | getPendingTasks、getAgentActiveTask、getTasksByExecutor |

## 用例统计

共 36 个端到端用例，覆盖核心业务流程全路径。

## 运行测试

```bash
cd /mnt/d/code/m-team
npx vitest run
```
