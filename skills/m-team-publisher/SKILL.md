---
name: m-team-publisher
description: Use when the current action is to publish a task into the M-Team pool, accept a completed task, reject a task by rewriting a concrete next step, or close an accepted task. First identify the current mode: publish, acceptance, reject, or close. Then read only the matching reference file. Use when a request must be rewritten into one pool-ready first baton, or when a publisher must evaluate whether a completed task should be accepted, rejected, or closed.
---

# M-Team Publisher

Use this skill only for publisher-side management actions in M-Team.

## Rule 0

Identify the current mode before reading details.

Modes:
- Publish mode
- Acceptance mode
- Reject mode
- Close mode

Read only the matching reference file.
Do not preload later-stage rules into the current stage.

## Mode map

- Publish mode -> references/publish-mode.md
- Acceptance mode -> references/acceptance-mode.md
- Reject mode -> references/reject-mode.md
- Close mode -> references/close-mode.md

## Extra references

- Good and bad examples -> references/examples.md

## Shared principles

- goal describes the final success state, not the current step
- description describes only the current baton, not the whole task chain
- publisher manages task quality and closure; publisher does not replace executor work
- use current M-Team runtime semantics: next, complete, fail
- prefer explicit, verifiable next-step instructions over vague language
