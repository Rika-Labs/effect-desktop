---
date: 2026-05-11
topic: Command unregister observability
issues: [665]
---

# Command unregister observability

`CommandRegistry.unregister` removed a command when present but silently
succeeded when the id was absent. That made an explicit lifecycle operation look
successful even when no command was removed.

The fix keeps guarded cleanup semantics for resource disposal and pending
registration races, but makes the public unregister path fail with
`CommandNotFound` when `remove` returns nothing. Existing replacement and
reservation tests still pass, so internal cleanup remains race-safe while
operator-facing unregisters stay observable.

The lesson is that idempotent cleanup is useful only at internal cleanup
boundaries. Public lifecycle commands should report absence because a missing
target often means the caller's model of the system is wrong.
