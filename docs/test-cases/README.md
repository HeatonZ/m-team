# 测试用例文档

> 按模块拆分的自然语言测试用例。当前版本已对齐 **链式状态机模型**：`ready / executing / handoff / reworking / finalizing / done`。

## 模块索引

| 模块编号 | 文件 | 新名称 | 内容 |
|------|------|------|------|
| M1 | [TC-A.md](./TC-A.md) | 链式正常流转 | 新任务 → 执行 → 交接 → 收口 → 完成 |
| M2 | [TC-B.md](./TC-B.md) | 交接与返工 | handoff / reworking / 旧 session 幂等 |
| M3 | [TC-C.md](./TC-C.md) | 失败与熔断 | session transcript 为空、不可恢复失败、loop guard 熔断 |
| M4 | [TC-D.md](./TC-D.md) | 取消与终态保护 | cancel 后的状态约束与权限边界 |
| M5 | [TC-E.md](./TC-E.md) | 回池与回收 | publisher 超时回收、非执行人限制 |
| M6 | [TC-F.md](./TC-F.md) | 已取消任务保护 | 已取消任务对残留动作的保护性处理 |
| M7 | [TC-G.md](./TC-G.md) | 并发与占用 | 并发认领、已有活跃任务限制 |
| M8 | [TC-H.md](./TC-H.md) | 守卫顺序 | cancelled / executor / phase 等 guard 顺序 |
| M9 | [TC-I.md](./TC-I.md) | 持久化一致性 | task.json 与 lifecycle/context 持久化 |
| M10 | [TC-J.md](./TC-J.md) | 排队与优先级 | 高优先级优先、同优先级 FIFO |
| M11 | [TC-K.md](./TC-K.md) | 底层存储映射 | 字段映射、lifecycle 序列化、单例 |
| M12 | [TC-L.md](./TC-L.md) | 查询与看板数据 | getPendingTasks / getRunningTasks / getTask |

## 命名规则

- 文件名暂保持 `TC-A` ~ `TC-L`，方便沿用现有引用路径
- 文档标题与索引名称统一使用**新业务名**，不再沿用旧“流程/读 API/db.js”式命名
- 每个模块优先表达**业务意图**，其次才是技术实现

## 编写原则

- 用自然语言描述，不写测试代码
- 先写业务期望，再写验证点
- 优先覆盖：
  1. phase 流转
  2. handoff / reworking 区分
  3. finalizing 收口
  4. loopGuard 防循环
  5. session 结束后的幂等保护
- 文档中的动作名、字段名、状态名必须与当前代码行为严格一致，不写“差不多”的旧口径

## 运行说明

当前仓库以**测试用例文档重构**为主。
如后续恢复自动化测试，应以这些文档为验收基线，再落具体测试实现。
