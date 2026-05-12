# Final message mode

Use this mode when the current baton has been worked and you are about to end the executor session.

## Purpose

Leave a clean transcript so `agent_end` can safely decide `next`, `complete`, or `fail`.

## What your final message must contain

Your final message should cover four things:

1. What was completed in the current baton.
2. What files, data, or artifacts were produced or updated.
3. What evidence shows the baton is done.
4. What unresolved issue remains, if any.

## Good final-message shape

Prefer a compact structured message such as:

```text
Result summary: completed <current baton action>.
Files: relative/path/a.json, relative/path/b.md
Evidence: a.json contains <key fact>; b.md records <checkable result>.
Unresolved issues: none
```

If there are unresolved issues, replace the last line with a short factual blocker description.

## Hard rules

- Do not decide `next`, `complete`, or `fail` yourself.
- Do not write manager-style acceptance language.
- Do not say the whole task goal is finished unless the current baton explicitly required proving that and the evidence is present.
- Do not leave vague lines such as "handled" or "done" without files or evidence.
- Do not copy large chunks of old context into the final message.

## Language rules

- Natural-language summary lines should be in Chinese unless the current baton requires another language.
- File paths, code identifiers, and JSON keys should stay unchanged.
