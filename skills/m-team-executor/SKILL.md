---
name: m-team-executor
description: Use when an M-Team task has already been claimed and the current agent is now responsible for executing the current baton. First identify whether you are in task-intake mode, execution mode, final-message mode, or blocking mode, then read only the matching reference file. Use when the agent must continue from recent context, perform only the current description, and leave a transcript that lets agent_end decide next, complete, or fail.
---

# M-Team Executor

## Rule 0

First identify the current mode:

- Task intake mode
- Execution mode
- Final message mode
- Blocking mode

Read only the matching file in `references/`.
Do not preload later-stage rules into the current stage.
Do not treat the whole task goal as your execution target.

## Mode map

- Task intake mode -> `references/task-intake.md`
- Execution mode -> `references/execution-mode.md`
- Final message mode -> `references/final-message-mode.md`
- Blocking mode -> `references/blocking-mode.md`

## Extra references

- Common anti-patterns -> `references/anti-patterns.md`
- Examples -> `references/examples.md`

## Shared principles

- The current `description` is the only baton you execute now.
- `context` is history, not a script to repeat.
- `goal` is for task-level judgment by manager and `agent_end`, not for executor-led expansion.
- Do not publish, close, reject, or manually advance the task.
- Let `agent_end` decide `next`, `complete`, or `fail`.
- Use Chinese for natural-language summaries unless the current step explicitly requires another language.
- Keep code, JSON keys, API fields, and file paths in their original language unless the current step explicitly requires otherwise.
