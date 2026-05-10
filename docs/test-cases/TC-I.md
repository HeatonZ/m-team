# M9：持久化一致性

**背景：** 每次关键状态变化后，`tasks/{taskId}/task.json` 都应与内存态、数据库态保持一致，特别是新的 `lifecycle`、`context`、`lastExecutor` 等字段。

---

## M9-1：发布任务后立即生成 task.json

**场景描述：** 发布任务后，文件系统中应立即落下可读的 `task.json`，供外部流程读取。

**测试步骤：**

1. 设置工作空间根目录为测试目录
2. Publisher 发布一个新任务
3. 验证文件路径存在：`tasks/{taskId}/task.json`
4. 读取文件内容
5. 验证文件中的以下字段与任务对象一致：
   - `taskId`
   - `status`
   - `description`
   - `lifecycle.phase=ready`

---

## M9-2：进入 handoff 后 task.json 同步更新

**场景描述：** 第一棒执行完成并交接后，磁盘上的 `task.json` 应立即体现新的 phase、lastExecutor 和 context。

**测试步骤：**

1. 发布任务并由 alice 认领
2. alice 完成当前步骤并结束 session
3. 终态收口后读取磁盘上的 `task.json`
4. 验证文件中已反映：
   - `status=pending`
   - `lifecycle.phase=handoff`
   - `lastExecutor=alice`
   - `handoffCount` 已增加
   - `context.length` 已增加

---

## M9-3：进入 reworking 后 task.json 同步更新

**场景描述：** 可恢复问题进入返工时，磁盘文件也必须同步更新，供后续执行人读取正确的纠偏 description。

**测试步骤：**

1. 构造一个会进入 `reworking` 的任务
2. 终态收口后读取 `task.json`
3. 验证文件中已反映：
   - `status=pending`
   - `lifecycle.phase=reworking`
   - `reworkCount` 已增加
   - `description` 已变成纠偏动作

---

## M9-4：完成后 task.json 保留完整链式历史

**场景描述：** 任务完成后，磁盘上的 `task.json` 不仅要标成完成，还要保留完整的链式 context 历史，便于复盘。

**测试步骤：**

1. 让任务经历至少两棒执行并最终完成
2. 读取 `task.json`
3. 验证文件中包含：
   - `status=completed`
   - `lifecycle.phase=done`
   - `completedAt`
   - 完整 context 历史
4. 验证前一棒交接信息没有丢失

---

## M9-5：数据库态、内存态、文件态三者一致

**场景描述：** 同一个任务在任一关键节点，数据库查询结果、内存中的任务对象、task.json 文件三者应保持一致。

**测试步骤：**

1. 选取一个经历过 phase 变化的任务
2. 分别读取：
   - 数据库记录
   - 运行时任务对象
   - `task.json`
3. 重点比对：
   - `status`
   - `lifecycle.phase`
   - `handoffCount`
   - `reworkCount`
   - `lastExecutor`
   - `context.length`
4. 验证三者一致
