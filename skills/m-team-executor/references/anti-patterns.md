# Common anti-patterns

## 1. Treating `goal` as the current instruction
Wrong:
- using the whole task goal as the executor action plan

Right:
- execute only the current `description`

## 2. Repeating finished work
Wrong:
- recomputing earlier batons because they are visible in context

Right:
- reuse prior artifacts unless the current baton explicitly says to repair or replace them

## 3. Leaving an empty closing message
Wrong:
- "done"
- "handled"
- "I completed it"

Right:
- state result, files, evidence, and unresolved issues clearly

## 4. Acting like manager or agent_end
Wrong:
- deciding to publish, reject, close, or manually advance the task

Right:
- end the session after a clear executor summary and let `agent_end` judge the task-level outcome

## 5. Expanding one baton into a chain
Wrong:
- planning several later batons inside the executor session

Right:
- finish only the current baton and report baton-level facts
