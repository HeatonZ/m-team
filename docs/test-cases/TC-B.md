# TC-B：中转交接流程

---

## TC-B1：单次 Relay

**场景描述：** Agent alice 认领后完成部分工作，交接给 agent bob，bob 最终完成。

**测试步骤：**

1. Publisher 发布任务，alice 认领成功，状态变为执行中
2. alice 追加上下文步骤"第一步"，输出部分结果
3. alice 调用交接接口，传入交接步骤和输出
4. 验证交接成功，任务状态变为待认领，执行人被清空，上一步执行人记录为 alice，上下文长度增加 1
5. 查询任务，确认：状态为待认领、执行人为空、上一步执行人为 alice、上下文长度为 2
6. bob 认领该任务，认领成功，状态恢复为执行中，执行人变为 bob
7. 验证任务中上一步执行人仍为 alice（bob 接手前的记录保留）
8. bob 调用完成接口
9. 验证完成成功，状态变为已完成，上下文长度为 3（alice 的工作记录保留）

---

## TC-B2：多次 Relay

**场景描述：** 任务经过 alice → bob → carol 三轮交接，每个人的工作记录都保留，最终完成。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. alice 交接，验证：上一步执行人 = alice，上下文长度 = 2
3. bob 认领，验证：执行人 = bob，上一步执行人 = alice
4. bob 交接，验证：上一步执行人 = bob，上下文长度 = 3
5. carol 认领，验证：执行人 = carol，上一步执行人 = bob
6. carol 完成
7. 查询任务，验证上下文长度为 4，包含 alice_step1、bob_step1、carol_final 三个步骤记录，每个人的输出都保留

---

## TC-B3：Relay 后旧 Session 结束

**场景描述：** Agent alice relay 后，旧 session 窗口关闭时又调用了 completeTask，系统应忽略不报错。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. alice 调用交接接口，任务变为待认领
3. alice 的旧 session 窗口调用 completeTask（此时任务已不是执行中状态）
4. 验证返回失败，原因是"任务不在执行中"，但任务本身状态保持为待认领，上下文未受影响
