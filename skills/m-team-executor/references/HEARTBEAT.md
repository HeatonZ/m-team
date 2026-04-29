# M-Team Executor 心跳模板

## sessionKey 格式

```
mteam:{taskId}:{agentId}:{timestamp}
```

Plugin 在 `mteam_claim_task` 内部通过 `api.runtime.subagent.run({ sessionKey })` 直接创建。HEARTBEAT agent 通过解析 sessionKey 提取 taskId（取第一段），不需要 label 过滤。

## 解析方式（TypeScript）

```typescript
function parseSessionKey(sessionKey: string): { taskId: string } | null {
  const parts = sessionKey.split(':');
  if (parts[0] === 'mteam' && parts.length >= 2) {
    return { taskId: parts[1] };
  }
  return null;
}
```

## 心跳循环（情况A：有任务）

```
WHILE true:
  1. sessions_getMessages(currentSession, limit=1)
     → 取最新一条消息的 updatedAt

  2. mteam_get_agent_active(agentId)
     → 返回 { task, lastHeartbeatAt, status }

  3. 判断:
     IF task == null:
       // 已完成任务，转情况B
       GOTO 情况B

     ELSE IF (now - lastHeartbeatAt > 60min) OR (heartbeat新但session旧):
       // 任务疑似僵尸
       IF now - lastHeartbeatAt > 60min:
         // 真正死亡，发 relinquish
         mteam_relinquish_task(taskId, executorId)
       ELSE:
         // 谎报（heartbeat在跑但session已停），仅发 nudge
       GOTO 情况B

     ELSE:
       // 正常：更新心跳
       mteam_update_task({ taskId, lastHeartbeatAt: Date.now() })
       sleep(10min)
```

## 情况B（空闲：认领新任务）

```
LOOP:
  pending = mteam_get_pending(agentId)
  IF pending 非空:
    // Plugin 内部已创建 session（mteam_claim_task 自动完成）
    // 只需更新心跳
    task = pending[0]
    mteam_update_task({ taskId: task.taskId, lastHeartbeatAt: Date.now() })
    // 不再需要手动 spawn session
  ELSE:
    sleep(5min)
```

## 关键约束

1. **Plugin 内部创建 session**：`mteam_claim_task` 调用时 Plugin 已通过 `api.runtime.subagent.run()` 创建了 session，Executor 不需要单独调 `sessions_spawn`
2. **sessionKey 格式**：`mteam:{taskId}:{agentId}:{timestamp}`，心跳时取 `split(':')[1]` 得到 taskId
3. **心跳时间窗口**：30min 疑似僵尸，60min 判定死亡
4. **谎报僵尸检测**：若 `lastHeartbeatAt` 很新但 session `updatedAt` 很旧，说明 heartbeat 在跑但 executor session 已卡死，此时不发 relinquish，只发 nudge
5. **一个 agent 一个任务**：通过 `mteam_get_agent_active` 保证不重复认领

## 工具依赖

- `sessions_getMessages` — 读 session 最后活跃时间
- `mteam_get_agent_active` — 获取当前任务和心跳时间
- `mteam_update_task({ lastHeartbeatAt })` — 更新心跳
- `mteam_relinquish_task` — 放弃死亡任务（60min 阈值）
- `mteam_get_pending` — 认领新任务
- `mteam_claim_task` — Plugin 内部已创建 session，此处只做 claim 操作
