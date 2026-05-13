---
name: m-team-runtime-map
description: End-to-end runtime map for the M-Team OpenClaw plugin. Use when an agent must understand the full closed loop (publish, claim, execute, agent_end adjudication, acceptance, close/reject), role boundaries, and status transitions before acting or when diagnosing drift.
---

# M-Team Runtime Map

Use this skill when you need a reliable mental model of the whole plugin lifecycle.

## Rule 0

Read `references/full-loop.md` first.
Then read only the reference file that matches your current need.

## Reference map

- Full lifecycle and decision points -> `references/full-loop.md`
- Role boundaries (publisher / executor / hooks) -> `references/role-boundaries.md`
- Tool + status transition matrix -> `references/tool-state-matrix.md`
- Failure and drift diagnosis checklist -> `references/diagnostics-checklist.md`

## Shared principles

- `description` is only the current baton, never the whole task chain.
- `goal` is final acceptance target, judged at task level (not executor self-closure).
- Executor does work; `agent_end` decides `next`, `complete`, or `fail`.
- Publisher handles acceptance (`close` / `reject`) and cancellation.
- Keep changes minimal, verifiable, and traceable in context outputs.

