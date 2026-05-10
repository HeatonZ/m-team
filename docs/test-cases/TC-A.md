# M1：链式正常流转

---

## M1-1：新任务经过 handoff 后完成

**场景描述：** Publisher 发布一个 research 任务。第一棒执行人完成当前步骤后交接给下一棒；第二棒继续执行并收口完成。整个过程体现链式主路径：`ready → executing → handoff → executing → done`。

**测试步骤：**

1. Publisher 调用 `mteam_publish_task`，传入：
   - `taskType=research`
   - `description="先整理最近 7 天的样本数据并给出可交接摘要"`
   - `goal="形成可直接用于月报的最终分析结论"`
2. 验证任务初始状态：
   - `status=pending`
   - `lifecycle.phase=ready`
   - `context.length=0`
3. Executor A 认领任务后，验证：
   - `status=running`
   - `lifecycle.phase=executing`
   - `executor=agent_alice`
4. Executor A 完成当前一棒并结束 session，最后输出中包含：
   - `summary`
   - `handoffNote`
   - `files` 或 `dataRefs`
5. 终态 hook 收口后，验证：
   - 任务回到 `pending`
   - `lifecycle.phase=handoff`
   - `lastExecutor=agent_alice`
   - `handoffCount=1`
   - `context.length=1`
6. Executor B 认领该任务，验证进入：
   - `status=running`
   - `lifecycle.phase=executing`
7. Executor B 基于前序 context 继续执行，不重做第一棒
8. Executor B 结束 session，最后输出表明目标已完成
9. 终态 hook 收口后，验证：
   - `status=completed`
   - `lifecycle.phase=done`
   - `completedAt` 已记录
   - `context.length=2`
10. Publisher 验收通过，调用 `mteam_close_task`
11. 验证最终状态为 `closed`

---

## M1-2：一步完成后直接 done

**场景描述：** 任务只有一棒，执行人完成后直接完成，不发生 handoff / reworking / finalizing 反复停留。

**测试步骤：**

1. Publisher 发布一个单步任务
2. Executor 认领后进入 `executing`
3. Executor 完成并结束 session，最后输出包含明确的完成说明
4. 终态 hook 收口后，验证：
   - `status=completed`
   - `lifecycle.phase=done`
   - `handoffCount=0`
   - `reworkCount=0`
   - `context.length=1`

---

## M1-3：进入 finalizing 后再 complete

**场景描述：** Executor 已完成主体工作，但还需要短暂收口整理，因此先进入 `finalizing`，下一轮再 complete。

**测试步骤：**

1. 发布任务并由 Executor 认领
2. Executor 完成主要工作，但最后输出明确表示：主体结果已齐，还需要整理最终交付口径
3. 终态 hook 收口后，验证：
   - `status=running`
   - `lifecycle.phase=finalizing`
   - `lastDecision=retain`
4. 同一执行人继续收口并结束 session
5. 再次收口后，验证：
   - `status=completed`
   - `lifecycle.phase=done`
6. 验证 finalizing 没有无限停留：不会连续多次 retain 却无有效进展

---

## M1-4：前序 context 被正确继承

**场景描述：** 第二棒执行人接手任务时，必须基于前序 context 继续，而不是重新做第一棒。

**测试步骤：**

1. 第一棒执行人完成后形成：`summary + handoffNote + dataRefs`
2. 任务进入 `handoff`
3. 第二棒执行人认领任务
4. 查询任务详情，确认能看到前序 context
5. 第二棒执行人按前序交接内容推进当前步骤
6. 验证结果中没有“重复第一棒”的痕迹，context 体现的是接续执行而非回炉重做

---

## M1-5：心跳只认领，不执行

**场景描述：** heartbeat session 只负责认领，不负责在心跳窗口里执行链式步骤。

**测试步骤：**

1. 让 executor heartbeat 收到一个适合自己的 pending 任务
2. heartbeat 调用 `mteam_get_pending` 后执行 `mteam_claim_task`
3. 验证 heartbeat 不调用 complete / fail / 执行类动作
4. 验证任务进入 `running + executing`
5. 后续实际执行由 task session 完成，而不是 heartbeat session 完成
