# TC-K：db.js 底层

**背景：** 测试 SQLite 底层封装，字段映射、序列化、连接管理。

---

## TC-K1：context 嵌套对象序列化正确

**场景描述：** 上下文中包含深层嵌套对象时，序列化和反序列化后数据应保持一致。

**测试步骤：**

1. 构造任务，上下文包含嵌套结构：data.nested.deep.value = 42，以及 items 数组和 map 对象
2. 插入数据库
3. 从数据库读取
4. 验证嵌套路径 data.nested.deep.value 等于 42，数组元素和 map 对象内容完全一致

---

## TC-K2：updateTaskRow 字段名映射正确

**场景描述：** 代码中使用 camelCase 字段名，数据库使用 snake_case 列名，映射应正确。

**测试步骤：**

1. 发布任务
2. 调用更新接口，同时传入 status、executor、completedAt、lastHeartbeatAt、lastExecutor
3. 直接查询数据库（绕过 ORM）
4. 验证：completedAt 正确映射到 completed_at 列，lastHeartbeatAt 映射到 last_heartbeat_at 列，lastExecutor 映射到 last_executor 列，值均正确

---

## TC-K3：openDb 重复调用返回同一实例

**场景描述：** 多次调用 openDb 同一路径，应返回同一个数据库实例（单例）。

**测试步骤：**

1. 第一次调用 openDb('/tmp/singleton_test.db')
2. 第二次调用 openDb('/tmp/singleton_test.db')
3. 验证两次返回的是同一个对象引用

---

## TC-K4：closeDb 后 getDb 抛出

**场景描述：** 关闭数据库后调用 getDb 应抛出明确错误。

**测试步骤：**

1. 打开数据库连接
2. 关闭数据库连接
3. 验证 isDbOpen() 返回 false
4. 调用 getDb()，验证抛出错误，错误信息包含"not opened"
