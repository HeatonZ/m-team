# M12：查询与看板数据

**背景：** 只读查询接口应与链式状态机字段保持一致，返回结果要能支持 phase 驱动看板和任务诊断。

---

## M12-1：已有活跃任务的 agent 不返回待认领任务

**场景描述：** `getPendingTasks(agentId)` 若发现该 agent 已有活跃任务，应返回空列表，防止一个 agent 同时执行多单。

**测试步骤：**

1. 发布两个任务
2. alice 认领第一个任务，状态变为 `running + executing`
3. 查询 `getPendingTasks('alice')`
4. 验证返回空列表
5. 查询 `getPendingTasks('bob')`
6. 验证 bob 仍能看到待认领任务

---

## M12-2：getRunningTasks 返回执行中的链式任务

**场景描述：** 查询运行中任务时，应返回带 `lifecycle.phase` 的结果，支持区分 `executing` 与 `finalizing`。

**测试步骤：**

1. 发布两个任务
2. 让 t1 处于 `running + executing`
3. 让 t2 处于 `running + finalizing`
4. 调用运行中任务查询接口
5. 验证返回结果包含 t1 和 t2
6. 验证每条记录都带正确的 `lifecycle.phase`

---

## M12-3：getTask 返回完整 lifecycle / loopGuard / context

**场景描述：** 详情接口应返回链式诊断所需字段，而不是只返回旧 status 基础信息。

**测试步骤：**

1. 构造一个经历过 handoff 与 reworking 的任务
2. 查询任务详情
3. 验证返回中包含：
   - `lifecycle.phase`
   - `handoffCount`
   - `reworkCount`
   - `lastDecision`
   - `loopGuard`
   - `context`
4. 验证 context 中能看到 step 输出摘要、交接说明和 unresolvedIssues

---

## M12-4：pending 列表可区分 ready / handoff / reworking

**场景描述：** 待认领列表虽然都属于 pending，但必须能从结果中区分它是新任务、正常交接还是返工修正。

**测试步骤：**

1. 构造三个 pending 任务，phase 分别为：`ready`、`handoff`、`reworking`
2. 调用 `getPendingTasks()`
3. 验证三个任务都能返回
4. 验证每个任务的 `lifecycle.phase` 与实际一致
5. 验证前端或调用方可以据此分到不同看板列
