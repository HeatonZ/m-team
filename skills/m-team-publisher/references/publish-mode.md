# Publish Mode

Use this file only when the current action is to rewrite a user request into one pool-ready first baton and publish it.

## Purpose

Turn a request into:
- the correct taskType
- one final goal
- one current-step description

Do not think about acceptance, reject, or close while you are still publishing.

## Step 0

Decide whether this should enter the pool.

Publish only if at least one is true:
- the work needs multiple batons
- the work will cross time boundaries
- the work is better handled by another agent identity, skill, or environment

Do not publish if:
- the current session can finish it directly
- it is only a tiny one-shot action
- the request is still too vague for an executor to start immediately

## Step 1

Choose taskType by the current baton, not by the final big goal.

Available values:
- general
- coding
- research
- ops
- data
- design
- content
- ecommerce

Rules:
- do not lazily default everything to general
- use general only for truly generic lightweight actions
- if this baton is searching, analyzing, or comparing, prefer research or data
- if this baton is implementing, modifying, or fixing code, prefer coding
- if this baton is cross-border ecommerce operation, prefer ecommerce

TaskType quick semantics:
- general: generic lightweight baton without strong specialist domain
- coding: implementation, debug, refactor, test, code-level validation
- research: search, compare, analyze, synthesize evidence
- ops: environment, deployment, service runtime, incident operation
- data: extraction, cleaning, transformation, metric calculation
- design: UI/UX and visual interaction deliverables
- content: writing/editing/publishing textual artifacts
- ecommerce: cross-border ecommerce execution (listing, pricing, sourcing, channel operation)

## Step 2

Write goal correctly.

goal describes the final success state.

A good goal:
- names the task object
- names the key constraints
- names what success looks like
- names the expected result shape at a high level

A bad goal:
- repeats the current baton
- includes roleplay or persona noise
- says who asked for it
- includes channel-routing or style fluff

## Step 3

Write description correctly.

description describes only the current baton.

Rules:
- one baton only
- executor can start immediately after reading it
- do not include whole-chain planning
- do not include acceptance, close, or publisher language
- keep it short and action-oriented
- keep it single-line when possible
- avoid multi-step connectors such as "then / 接着 / 然后"
- include explicit target and constraint when needed

Good pattern:
- action plus target plus constraint

## Step 4

Publish checklist.

Before calling mteam_publish_task, confirm all of these:
1. taskType matches the current baton
2. goal is final-state oriented
3. description is single-step and current-baton only
4. description does not repeat goal
5. description is self-contained enough for an executor to start
6. quantity logic is explicit when quantities are involved
7. multi-action requests have been split to only the first baton

## Step 5

Publish with:
- taskType
- goal
- description
- publisher
- priority

After publishing:
- confirm that the task was published
- do not manually micromanage executor work in the same mode
- leave later acceptance, reject, and close work to the appropriate later mode
