# TC-A：正常完成流程

---

## TC-A1：Executor 完整执行并由 hook 判断完成

**场景描述：** Publisher 发布一个高优先级任务，Executor A 认领后分步执行（数据清洗 → 生成图表），Executor A 执行完后 agent_end hook 判断 relay；Executor B 认领后完成，agent_end hook 判断 complete → completed。

**测试步骤：**

1. Publisher 调用 `mteam_publish_task`，传入 description="分析销售数据"、goal="生成月报"、priority="high"、publisher="boss"
2. 系统生成任务 ID，任务状态为 `pending`，executor=null
3. 查询该任务，验证：任务存在、status=`pending`、executor=null、lastExecutor=null、context.length=1（只有初始 input）、priority=high、publisher=boss、completedAt=null
4. Executor "agent_alice" 调用 `mteam_claim_task`，认领成功，状态变为 `running`，executor=agent_alice
5. 查询任务，验证 status=`running`，executor=agent_alice
6. Executor agent_alice 执行"数据清洗"，写文件到 workspace，**然后结束 session**
7. agent_end hook 触发：
   - 读取 event.messages（完整对话记录）
   - LLM 判断：description 还有下一步 → `relayTask`
   - 任务状态变为 `pending`，executor=null，lastExecutor=agent_alice，context 追加步骤
8. 验证 context.length=2，第二项 step="数据清洗"，output 指向输出文件，status=`pending`
9. Executor "agent_bob" 调用 `mteam_claim_task`，状态变为 `running`，executor=agent_bob
10. Executor agent_bob 执行"生成图表"，**然后结束 session**
11. agent_end hook 触发：
    - LLM 判断：description 已全部完成 → `completeTask`
    - 任务状态变为 `completed`，completedAt 被记录，executor=null
12. 验证 status=`completed`，completedAt 不为空，context.length=3
13. Publisher 心跳检测到 COMPLETED 任务，调用 `mteam_close_task` → status=`closed`
14. 验证 status=`closed`（终态）
15. 查询 agent_alice 的活跃任务，返回 null
16. 查询 agent_bob 的待认领任务，正常返回（无 running 任务可认领新任务）

---

## TC-A2：Executor 执行完，hook 判断 relay

**场景描述：** Executor 认领后执行完当前步骤，agent_end hook 判断仍需继续，relay 回池子。

**测试步骤：**

1. Publisher 发布任务，Executor 认领成功，状态 `running`
2. Executor 执行步骤，写文件，**结束 session**
3. agent_end hook 触发：
   - LLM 读取 messages，判断 description 还有下一步
   - 调用 `relayTask`，status → `pending`，executor → null
4. 验证 status=`pending`，executor=null，context 已追加步骤
5. 下一个 Executor 认领同一任务，继续执行

---

## TC-A3：快速完成（一步完成）

**场景描述：** Executor 认领后一步完成，agent_end hook 判断 complete，任务直接 `completed`。

**测试步骤：**

1. Publisher 发布任务，Executor 认领成功
2. Executor 执行步骤，写文件，**结束 session**
3. agent_end hook 触发：
   - LLM 读取 messages，判断 goal 已达成
   - 调用 `completeTask`，status → `completed`，completedAt 被记录
4. 验证 status=`completed`，completedAt 不为空，context.length=2（初始 input + 步骤）

---

## TC-A4：Executor 异常退出，hook 判断 fail

**场景描述：** Executor 认领后崩溃/异常退出，agent_end hook 检测到 success=false，直接 failTask。

**测试步骤：**

1. Publisher 发布任务，Executor 认领成功，状态 `running`
2. Executor session 非正常结束（崩溃、超时、错误）
3. agent_end hook 触发：
   - 检测 event.success=false
   - 调用 `failTask`，status → `failed`，error 记录原因
4. 验证 status=`failed`，任务不再被认领
5. 可手动 `relinquish` 后重新发布，或关闭任务

---

## TC-A5：心跳保活（executor 正常执行期间）

**场景描述：** Executor 认领任务后正常执行（多轮对话），最终结束 session。heartbeat prompt 注入只管查任务，不干扰 executor。

**测试步骤：**

1. Publisher 发布任务，Executor 认领成功，状态 `running`
2. Executor 与用户多轮对话，执行任务步骤
3. Executor 期间 heartbeat session 独立运行，不影响 executor
4. Executor 执行完毕，**结束 session**
5. agent_end hook 触发，判断 complete 或 relay
6. 验证任务状态正确流转
