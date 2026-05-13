# Role boundaries

## Publisher

Allowed responsibilities:

- Publish task with clear `goal` + current-step `description`
- Accept or reject completed output
- Cancel task when needed
- Run timeout reclaim in publisher heartbeat

Not allowed / not recommended:

- Replacing executor and manually doing all execution chain
- Using vague reject reason without a concrete next baton

## Executor

Allowed responsibilities:

- Claim suitable task
- Execute only current baton
- Produce verifiable outputs (files, logs, results)
- Provide concise final report for adjudication

Not allowed:

- Close/reject/cancel by itself
- Expand current baton into entire project scope without instruction

## Hook layer

- `heartbeat_prompt_contribution`
  - injects claim guidance for executors
  - injects timeout + acceptance guidance for publishers
- `agent_end`
  - adjudicates task-level transition from execution transcript/output
- `after_tool_call`
  - writes auditable task logs for key tool actions

