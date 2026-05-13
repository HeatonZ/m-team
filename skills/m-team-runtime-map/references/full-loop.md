# Full loop (single-task, multi-step)

## Lifecycle overview

1. **Publish**
   - Tool: `mteam_publish_task`
   - Result: task enters `pending`
   - Required quality: clear `goal`, single-step `description`, proper `taskType`

2. **Claim**
   - Trigger: executor heartbeat guidance
   - Tools: `mteam_get_pending` -> `mteam_claim_task`
   - Result: `pending -> running`
   - Constraint: only suitable agent should claim by taskType + capability

3. **Execute current baton**
   - Executor performs only current `description`
   - Executor should produce concrete artifacts and concise final report
   - Do not self-close task

4. **Agent-end adjudication**
   - Hook: `agent_end`
   - LLM judge outputs one of:
     - `next` -> write context step, set next `description`, return to `pending`
     - `complete` -> mark `completed` (awaiting publisher acceptance)
     - `fail` -> mark `failed`
   - Plugin uses fail-fast if adjudication is unavailable/invalid

5. **Publisher acceptance**
   - Heartbeat order:
     1) timeout reclaim scan on `running`
     2) acceptance on `completed`
   - Tools:
     - pass: `mteam_close_task` (`completed -> closed`)
     - reject: `mteam_reject_task` (`completed -> pending` with rewritten next baton)

6. **End states**
   - `closed`: accepted and done
   - `failed`: blocked or invalid path
   - `cancelled`: publisher canceled task

## Core closed-loop guarantee

- Every executor run must end in one adjudicated transition: `next`, `complete`, or `fail`.
- No executor can bypass acceptance by directly closing a task.

