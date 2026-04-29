# TC-A：正常完成流程

---

## TC-A1：Agent 完整执行并完成任务

**场景描述：** Publisher 发布一个高优先级任务，Agent 认领后分步执行（数据清洗 → 生成图表），最终提交完成。

**测试步骤：**

1. Publisher 调用发布接口，传入任务描述"分析销售数据"、目标"生成月报"、优先级"高"、发布者"boss"
2. 系统生成任务 ID，格式为 task_ 时间戳 _ 随机字符，任务状态为待认领，执行人为空
3. 查询该任务，验证：任务存在、状态为待认领、执行人字段为空、上一步执行人字段为空、上下文长度为 1（只有初始输入）、上下文中第一项类型为 input、优先级为高、发布者为 boss、完成时间为空
4. Agent "agent_alice" 认领该任务，认领成功，任务状态变为执行中，执行人变为 agent_alice
5. 查询任务，验证状态为执行中，执行人为 agent_alice
6. Agent 完成"数据清洗"，调用 `mteam_relay_task(task_id, agentId="agent_alice", contextStep="数据清洗", contextOutput={ summary: "清洗5000行", files: ["清洗结果.json"] })`，任务状态变为待认领，执行人清空
7. 验证上下文长度变为 2，第二项步骤名为"数据清洗"，output 指向输出文件，执行人字段为空，状态为待认领
8. Agent "agent_bob" 认领该任务，认领成功，任务状态变为执行中，执行人变为 agent_bob
9. Agent 完成"生成图表"，调用 `mteam_relay_task(task_id, agentId="agent_bob", contextStep="生成图表", contextOutput={ summary: "生成3张图表", files: ["图表1.png", "图表2.png", "图表3.png"] })`，任务状态变为待认领，执行人清空
10. 验证上下文长度变为 3，第二项步骤名为"数据清洗"、第三项步骤名为"生成图表"，执行人字段为空，状态为待认领
11. Agent "agent_alice" 再次认领该任务，调用 `mteam_complete_task(task_id, contextStep="最终提交", contextOutput={ summary: "月报已完成" })`，任务状态变为 completed，完成时间被记录，执行人清空
12. 验证完成成功，任务状态变为 completed，完成时间被记录，执行人字段被清空，上下文长度变为 4
13. 再次查询任务，验证状态为 completed、完成时间不为空、执行人字段为空
14. 查询 agent_alice 的活跃任务，返回空（因为任务已完成）
15. 查询 agent_alice 的待认领任务，返回空（因为有完成记录，不应再分配新任务）

---

## TC-A2：心跳保活

**场景描述：** Agent 认领任务后只发送心跳，不改变状态和上下文。

**测试步骤：**

1. Publisher 发布任务，Agent 认领成功
2. Agent 发送心跳更新（只传时间戳，不传状态和上下文）
3. 验证返回结果中心跳时间被更新，状态保持执行中，上下文长度保持为 1（无追加）

---

## TC-A3：快速完成（一步完成）

**场景描述：** Agent 认领后直接完成，调用 `mteam_complete_task` 传入最终步骤，任务立即完成。

**测试步骤：**

1. Publisher 发布任务，Agent 认领成功
2. Agent 调用 `mteam_complete_task(task_id, contextStep="任务完成", contextOutput={ summary: "完成" })`
3. 验证完成成功，任务状态变为 `completed`，完成时间被记录
4. 验证上下文长度变为 2（初始 input + 最终步骤），最终步骤的 step 和 output 正确

## TC-A4：relay_task 交接流转

**场景描述：** Agent 认领后执行完毕，调用 `relay_task` 将任务交回任务池，下一个 agent 继续执行。

**测试步骤：**

1. Publisher 发布任务，Agent 认领成功
2. Agent 执行完当前步骤，调用 `mteam_relay_task(task_id, agentId, contextStep, contextOutput)`，传入当前步骤名和输出文件路径
3. 验证 relay 成功，任务状态变为待认领，执行人清空，上下文追加当前步骤（长度 +1）
4. 下一个 agent 认领同一任务，继续执行
