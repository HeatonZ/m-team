# Step Contract Guidance

Use this reference whenever you need to define or rewrite a task contract for one baton.

## Purpose

A step contract makes the current baton:
- executable
- checkable
- easier to hand off or evaluate

## Fields

### expectedOutcome

This describes the intended result of the current baton.
It is not a file name list.
It is the outcome the baton should achieve.

Good examples:
- obtain five valid candidate products with evidence
- restore the script to a runnable state
- produce one executable plan with goal, steps, and risks

### doneWhen

These are verifiable completion checks.
They must be concrete.

Good examples:
- five valid products have been found
- the result file exists and contains the required fields
- the script runs successfully and produces the expected result

Bad examples:
- almost done
- looks fine
- improve it a bit more

### constraints

Use constraints to prevent drift.
Examples:
- handle only the current baton
- do not expand into the whole task chain
- do not write whole-task completion judgment into the current output

### inputHints

Use inputHints when the executor needs a starting direction.
Examples:
- use files from the most recent context step first
- inspect existing task-directory outputs before filling gaps
- continue from the current candidate set before expanding the search

## Quality rules

A good step contract is:
- specific
- current-step only
- verifiable
- not overloaded

A bad step contract is:
- vague
- whole-task oriented
- impossible to verify
- mixed with roleplay or publishing noise
