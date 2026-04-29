# TC-H：守卫顺序验证

**背景：** relayTask 和 relinquishTask 中存在两个守卫条件：CANCELLED 检查 和 executor 检查。如果 CANCELLED 检查在 executor 检查之后，会导致 Bug：cancelTask 清空 executor 后，relayTask 会先检查 executor != alice（返回 NOT_CURRENT_EXECUTOR）而不是先检查 CANCELLED（应返回 TASK_CANCELLED）。

---

## TC-H1：cancelTask 后 executor 清空，relayTask 应返回 TASK_CANCELLED

**场景描述：** 验证 relayTask 中 CANCELLED 检查在 executor 检查之前。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. Publisher 取消任务，任务变为已取消，执行人被清空（变为 null）
3. alice（使用已被清空的 executor 身份）调用 relayTask
4. 验证 relay 返回失败，原因为"任务已取消"
5. 若守卫顺序反了：会先检查 executor != alice（alice 已被清空为 null），返回"不是当前执行人"，这是 Bug

---

## TC-H2：relinquishTask 守卫顺序同样验证

**场景描述：** 验证 relinquishTask 中 CANCELLED 检查在 executor 检查之前。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. Publisher 取消任务，任务变为已取消，执行人被清空
3. alice 调用 relinquishTask
4. 验证返回失败，原因为"任务已取消"
