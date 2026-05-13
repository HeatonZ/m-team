# M-Team Dashboard Requirements (Slim Version)

## 1. Purpose

This dashboard focuses on the current simplified M-Team workflow:

- `next`: enqueue the next single step
- `complete`: executor step work is done, awaiting publisher acceptance
- `fail`: task is blocked/failed and needs intervention

No phase/lifecycle model is required.

## 2. Core Views

### 2.1 Active Board

Show active tasks grouped by status intent:

- **New pending**: `pending` with empty context
- **Waiting next claim**: `pending` with non-empty context
- **Running**: `running`
- **Blocked / risky**: pending/running tasks whose latest step has unresolved issues or stale update time

### 2.2 History

Show completed terminal states:

- `completed`
- `closed`
- `failed`
- `cancelled`

### 2.3 Logs

Primary actions to inspect:

- publish
- claim
- next
- complete
- fail
- close
- reject
- cancel
- relinquish

For `agent_end` decisions, show:

- decision
- reason
- nextDescription (if any)
- evidence summary
- llm/raw decision trace when available

## 3. Task Card Content

Each card should show:

- task id
- task type
- status
- priority
- current description (current step only)
- latest summary
- latest files (compact list)
- latest unresolved issues (if any)
- executor / last executor
- updated time freshness

## 4. Task Detail Modal

Detail modal should include:

- basic metadata (publisher/executor/time)
- current focus (current step + latest summary + outputs)
- unresolved issues block
- context timeline (step, executor, summary, files, issues)

Do not display deprecated lifecycle/phase/stepContract fields.

## 5. Data Model (Frontend)

Task:

- taskId
- taskType
- goal
- description
- context[]
- priority
- status
- publisher
- executor
- lastExecutor
- createdAt
- updatedAt
- completedAt

Context step output:

- summary?
- files?
- unresolvedIssues?
- error?

## 6. Acceptance Criteria

1. Board grouping reflects only status + context-driven semantics (no phase dependency).
2. Task cards and detail modal show current-step-centric information clearly.
3. Logs surface `agent_end` decision details and evidence.
4. Build and tests pass.
