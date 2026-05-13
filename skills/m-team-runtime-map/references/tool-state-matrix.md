# Tool and state transition matrix

## Status set

- `pending`
- `running`
- `completed`
- `closed`
- `failed`
- `cancelled`

## Main transitions

- `mteam_publish_task`: create task -> `pending`
- `mteam_claim_task`: `pending -> running`
- `mteam_next_task`: `running -> pending` (append context step + new description)
- `agent_end => complete`: `running -> completed`
- `agent_end => fail`: `running -> failed`
- `mteam_close_task`: `completed -> closed` (publisher only)
- `mteam_reject_task`: `completed -> pending` (publisher rewrite next baton)
- `mteam_cancel_task`: non-terminal active task -> `cancelled` (publisher decision)
- `mteam_relinquish_task`: stale/timeout running task -> `pending` (reclaim path)

## Practical invariants

1. Only one executor holds a task while `running`.
2. `completed` is not terminal acceptance; it must be closed or rejected.
3. Rejection must produce an actionable next baton.
4. Context stores completed-step outputs; `description` stays short and current-step only.

