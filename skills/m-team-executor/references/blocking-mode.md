# Blocking mode

Use this mode when the current baton cannot be finished cleanly.

## Purpose

Report a real blocker as a baton-level fact, without inventing the next baton yourself.

## What to report

State briefly:

- what you tried,
- where the baton is blocked,
- what artifact or evidence you still produced,
- and what exact missing condition prevented completion.

## Good blocking message shape

```text
Result summary: attempted <current baton action> but the baton is blocked.
Files: relative/path/debug.md
Evidence: debug.md records the exact command, output, and failure point.
Unresolved issues: missing <permission/input/dependency/environment condition> required to finish the current baton.
```

## Hard rules

- Do not invent a manager instruction.
- Do not write a multi-step rescue plan.
- Do not hide the blocker behind vague text like "needs follow-up".
- Do not claim the baton is complete if the blocker prevented the required result.
