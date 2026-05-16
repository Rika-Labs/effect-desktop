# Serialize WindowState mutations

## Planned

Close issue #670 by preventing concurrent `WindowState.persist` calls from losing independent window records.

## Shipped

`WindowState` now guards `persist` and `clear` with a single service-local semaphore so each durable read-modify-write completes before the next mutation starts. `restore` and `restoreAll` remain unlocked because they do not write durable state.

## Review surfaced

The race was not in the atomic file replace. The unsafe section was the earlier read-modify-write: two fibers could read the same store, each write a different single-window update, and the later replace would erase the earlier update.

## Lesson

Atomic writes protect file integrity, not logical merge integrity. Any durable store API that exposes independent record updates over a whole-store file needs a mutation gate or a compare-and-retry protocol around the full read-modify-write.

## AGENTS.md amendment candidate

None.
