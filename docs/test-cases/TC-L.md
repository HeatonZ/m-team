# TC-L：读 API

**背景：** pool/index.js 对外暴露的只读查询接口，依赖 db.js。

---

## TC-L1：Agent 有活跃任务时不再返回待认领任务

**场景描述：** getPendingTasks 如果传入 agentId 且该 Agent 有活跃任务，应返回空列表（防止一个 Agent 同时跑多个任务）。

**测试步骤：**

1. 发布两个任务
2. alice 认领第一个任务，状态变为执行中
3. 查询 alice 的待认领任务，返回空列表（因为 alice 已有活跃任务）
4. 查询 bob 的待认领任务，返回至少 1 条（bob 无活跃任务，可正常看到待认领任务）

---

## TC-L2：getAgentActiveTask 返回当前 Runner

**场景描述：** 查询某 Agent 是否在执行任务，应返回对应的 RUNNING 状态任务。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. 查询 alice 的活跃任务，返回该任务，状态为执行中，执行人为 alice
3. 查询 bob 的活跃任务，返回空（bob 未在执行任何任务）

---

## TC-L3：getTasksByExecutor 按执行人筛选

**场景描述：** 查询某 Agent 名下的所有任务（包括各种状态）。

**测试步骤：**

1. 发布三个任务 t1、t2、t3
2. alice 认领 t1 并完成，t1 变为已完成
3. bob 认领 t2（t2 仍为执行中）
4. t3 保持待认领（无人认领）
5. 查询 alice 名下的任务，返回 1 条（t1）
6. 查询 bob 名下的任务，返回 1 条（t2）
7. 查询结果均不包含 t3（因为 t3 执行人为空）
