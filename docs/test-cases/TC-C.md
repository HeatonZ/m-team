# M3：失败与熔断

---

## M3-1：session transcript 为空时直接失败

**场景描述：** 终态 hook 触发时，如果拿不到有效 transcript，不应继续做 LLM 判决，而应直接按不可恢复失败处理。

**测试步骤：**

1. 发布任务并让 Executor 认领
2. 模拟 session 结束，但 `sessionFile` 为空或 transcript 解析后无有效内容
3. 验证系统直接写入失败结果
4. 验证任务状态为：
   - `status=failed`
   - `lifecycle.phase=done` 或终态失败态
5. 验证失败原因明确包含 transcript 缺失/为空

---

## M3-2：不可恢复错误直接失败

**场景描述：** Executor 遇到权限、登录失效、关键依赖缺失等不可恢复问题，系统应直接 fail，不进入 reworking。

**测试步骤：**

1. 发布需要外部权限的任务
2. Executor 执行后明确输出：无权限/登录失效/前置缺失
3. 终态 hook 收口后，验证：
   - `status=failed`
   - 失败原因已记录
   - 任务不会重新回到待认领池

---

## M3-3：无进展熔断

**场景描述：** 同一任务连续多次没有新增有效进展时，系统必须熔断，不能继续 retain 或原样 relay。

**测试步骤：**

1. 构造一个任务，让执行人连续两轮结束 session 都没有新增文件、数据引用或有效摘要变化
2. 验证 loopGuard 的 `noProgressCount` 累加
3. 当达到阈值后，验证系统不再 retain
4. 最终动作必须变成 fail 或明确的 reworking，而不是继续空转

---

## M3-4：same phase 停留过久触发重新评估

**场景描述：** 任务长期停留在同一 phase 时，系统应强制重新评估，而不是惯性维持原状态。

**测试步骤：**

1. 让任务连续多轮停留在同一 phase（例如 finalizing）
2. 每轮都没有足够的新进展支撑 retain
3. 验证 `samePhaseCount` 递增
4. 达到阈值后，验证系统改走 complete / relay / fail 之一

---

## M3-5：可恢复业务错误改写为 reworking

**场景描述：** 业务结果不合格但仍可修正时，系统应优先进入 `reworking`，而不是 terminal fail。

**测试步骤：**

1. 发布一个带硬约束的业务任务
2. Executor 给出部分可用结果，但其中存在明显不合格项
3. 终态判断初始倾向为失败
4. 验证本地 guard 将其改写为 recovery relay
5. 验证任务状态为：
   - `status=pending`
   - `lifecycle.phase=reworking`
   - description 变成明确的纠偏动作
