# Diagnostics checklist (drift / mis-claim / loop issues)

Use this when a task behaves unexpectedly.

## A. Claim quality

1. Check task `taskType` is explicit and correct.
2. Check claim-routing config allows only intended agents for this type.
3. Check agent identity/prompt states what task types it should claim.
4. Verify claimant had no active running task at claim time.

## B. Baton quality

1. `description` contains one executable current step only.
2. `description` does not include full goal or acceptance narrative.
3. `goal` is outcome-focused and testable.
4. Required inputs from previous context are present.

## C. Execution output quality

1. Final report contains concrete result, not only intention.
2. Artifacts/paths are explicit when files were produced.
3. Unresolved issues are real blockers, not placeholders.
4. No fake “done” statement without evidence.

## D. Agent-end adjudication quality

1. Check adjudication log source (`llm` vs fail-fast path).
2. For `next`, ensure next description is not identical to current step unless justified.
3. For `complete`, verify outputs satisfy `goal` acceptance criteria.
4. For `fail`, verify reason is actionable and specific.

## E. Publisher acceptance quality

1. Timeout reclaim runs before acceptance in heartbeat.
2. Acceptance checks goal + context + artifacts together.
3. Reject reason includes concrete issue + rewritten next baton.
4. Close only after explicit acceptance.

