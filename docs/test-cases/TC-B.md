# M2：交接与返工

---

## M2-1：单次 handoff

**场景描述：** 第一棒执行人完成当前步骤后，把任务正常交给下一棒，任务进入 `handoff`，而不是模糊地回到普通 pending。

**测试步骤：**

1. Publisher 发布多步任务
2. Executor A 认领任务，进入 `running + executing`
3. Executor A 完成当前步骤并结束 session，最后输出含 `handoffNote`
4. 终态 hook 收口后，验证：
   - `status=pending`
   - `lifecycle.phase=handoff`
   - `lastExecutor=agent_alice`
   - `handoffCount=1`
5. Executor B 认领并继续下一棒
6. 验证前一棒记录完整保留在 context 中

---

## M2-2：返工修正进入 reworking

**场景描述：** 当前结果存在可恢复问题，系统不直接 fail，而是把任务放回池子做纠偏，进入 `reworking`。

**测试步骤：**

1. 发布一个带明确硬约束的任务（例如数量、规格、筛选条件）
2. Executor A 完成当前步骤，但产出中混入不合格结果
3. 终态 hook 判断该问题可恢复，应生成新的纠偏 description
4. 验证任务被放回池子后：
   - `status=pending`
   - `lifecycle.phase=reworking`
   - `reworkCount=1`
   - description 已变成纠偏动作，而不是原样不动
5. 下一棒执行人认领后按纠偏 description 修正任务

---

## M2-3：旧 session 结束后的幂等保护

**场景描述：** 任务已经进入 `handoff` 或 `reworking` 后，旧 session 再次结束或重复触发收口，系统应跳过，不重复推进终态。

**测试步骤：**

1. Executor A 完成一棒，任务已成功进入 `handoff`
2. 模拟同一 `taskId + sessionKey` 再次触发终态收口
3. 验证系统识别为重复 terminal event 并跳过
4. 验证任务状态、description、context 均不再重复变更

---

## M2-4：same description 禁止原样 relay

**场景描述：** 如果新的 description 与当前 description 完全相同，不能继续原样放回池子，否则会形成心跳反复认领的循环。

**测试步骤：**

1. 构造一个执行结束后没有新推进的任务
2. 让终态判断尝试生成与当前完全相同的 description
3. 验证 loop guard 阻断原样 relay
4. 验证结果不是“原样 handoff”，而是进入 fail、reworking 或其它更能收口的动作

---

## M2-5：同一执行人 finalizing retain 次数受限

**场景描述：** finalizing 可以短暂 retain，但不能无限 retain。

**测试步骤：**

1. 让任务进入 `running + finalizing`
2. 连续两轮由同一执行人结束 session，但都没有新增有效进展
3. 验证系统不会无限 retain
4. 最终必须在 complete / relay / fail 中三选一收口
