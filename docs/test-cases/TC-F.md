# TC-F：Cancelled 任务的宽容处理

**背景：** cancelTask 后，executor 侧可能还有残留调用（updateTask/heartbeat），系统应宽容处理：允许追加 context/heartbeat，但拒绝 relay/complete。

---

## TC-F1：Cancelled 任务允许追加上下文

**场景描述：** cancelTask 后，executor 侧还有残留的上下文追加调用（如记录日志），系统应宽容处理。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. Publisher 取消任务，任务变为已取消
3. alice 追加一条上下文步骤"事后通知用户"
4. 验证追加成功，任务状态保持为已取消（不变），上下文长度增加 1

---

## TC-F2：Cancelled 任务拒绝 Relay

**场景描述：** 已取消的任务不允许通过 updateTask(PENDING) 重新放回待认领。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. Publisher 取消任务，任务变为已取消
3. 调用 updateTask 尝试将状态设为待认领（意图 relay）
4. 验证返回结果中包含错误标记"任务已取消"
5. 查询任务，确认状态仍为已取消，未被改变

---

## TC-F3：Cancelled 任务拒绝 Complete

**场景描述：** 已取消的任务不允许被标记为完成。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. Publisher 取消任务，任务变为已取消
3. alice 调用完成接口
4. 验证返回失败，原因为"任务不在执行中（已取消状态）"
