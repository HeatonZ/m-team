# M-Team 任务健康检查

> 判断执行者的任务是否真实在执行。结合 OpenClaw 平台心跳 + m-team 任务心跳，两层校验。

**触发时机：** 任意 agent 每次 HEARTBEAT 时调用。

---

## 输入

- `agentId`: string — agent 的 id（如 `"agent_1"`, `"researcher"`, `"writer"`）

---

## 判断逻辑

### 第一层：OpenClaw Agent 心跳（平台校验）

```
sessions_list(agentId: "{agentId}")
→ 过滤 key 含 "heartbeat" 的 session
→ 检查 updatedAt 是否在 20 分钟内
```

| 结果 | 含义 |
|------|------|
| ✅ 有最近 heartbeat session | OpenClaw 心跳正常，agent 还活着 |
| ❌ 没有或太旧 | OpenClaw 心跳卡了，agent 本身可能挂了 |

### 第二层：m-team 任务心跳（任务校验）

```
mteam_get_agent_active({ agentId })
→ 检查 lastHeartbeatAt 是否在 20 分钟内
```

| 结果 | 含义 |
|------|------|
| ✅ 有任务 + 心跳新 | 任务真的在跑 |
| ⚠️ 有任务 + 心跳旧 | 任务疑似僵尸（>20 分钟没更新） |
| ❌ 无任务 | 没有进行中的任务 |

---

## 综合判断表

| OpenClaw 心跳 | m-team 心跳 | 结论 | 操作 |
|--------------|------------|------|------|
| ✅ 新 | ✅ 新 | 任务正常在跑 | 无 |
| ✅ 新 | ⚠️ 旧/无 | 任务卡了，agent 还活着 | 记录 `task_stale`，报告 manager |
| ❌ 旧 | 任意 | OpenClaw 心跳卡了 | 记录 `heartbeat_stale`，通知重启 |

---

## 输出格式

```json
{
  "agentHeartbeat": {
    "hasSession": true,
    "sessionKey": "agent:my-agent:main:heartbeat",
    "updatedAt": 1745740800000,
    "isFresh": true
  },
  "taskHeartbeat": {
    "hasTask": true,
    "taskId": "task_xxx",
    "status": "running",
    "lastHeartbeatAt": 1745740800000,
    "isFresh": true
  },
  "verdict": "healthy" | "task_stale" | "heartbeat_stale",
  "action": "none" | "report_to_manager" | "request_restart"
}
```

---

## 使用方式

每次 HEARTBEAT 时，任务池检查完成后，立即调用本 skill 进行健康检查。

```
读本 SKILL.md → 执行 sessions_list + mteam_get_agent_active → 综合判断 → 根据 verdict 行动
```
