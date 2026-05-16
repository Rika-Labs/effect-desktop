## Findings

| Severity | File:Line                                    | Finding                                                                                                          |
| -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Major    | `packages/core/src/runtime/event-log.ts:413` | `markReadOnly` swallowed metadata update failures without logging, making failed durable latch writes invisible. |

## Decision

Address. The finding cites the repo-local no-swallowed-errors rule and does not conflict with the locked architecture.

Handoff: `/address`
