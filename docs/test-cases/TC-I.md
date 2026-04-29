# TC-I：文件系统持久化

**背景：** 每次写操作后，task.json 文件应同步更新到 `tasks/{taskId}/` 目录下，供外部（如 agents）直接读文件系统。

---

## TC-I1：publishTask 同步写入 task.json

**场景描述：** 发布任务时，task.json 文件应同步创建在 tasks/{taskId}/ 目录下。

**测试步骤：**

1. 设置工作空间根目录为测试临时目录
2. Publisher 发布任务，任务描述为"持久化测试"
3. 验证文件路径存在：tasks/{taskId}/task.json
4. 读取文件内容，验证 JSON 中 taskId、status、description 与内存中任务一致

---

## TC-I2：relayTask 同步更新 task.json

**场景描述：** 交接任务后，磁盘上的 task.json 应同步更新为最新的任务状态。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. alice 调用交接接口，传入步骤和输出
3. 从磁盘读取 task.json
4. 验证文件中的状态为待认领、执行人为空、上一步执行人为 alice、上下文长度已更新

---

## TC-I3：updateTask 同步更新 task.json

**场景描述：** 每次 updateTask 调用后，磁盘上的 task.json 应同步更新。

**测试步骤：**

1. Publisher 发布任务，alice 认领
2. alice 调用 updateTask 追加上下文步骤
3. 从磁盘读取 task.json
4. 验证文件中的上下文长度、executor 等字段与数据库查询结果一致
