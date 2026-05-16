## Domain

EventLog disk-full recovery state, specifically the transition from writable append mode to durable read-only mode after SQLite reports `SQLITE_FULL`.

## Evidence gathered

- `packages/core/src/runtime/event-log.ts` — `append` checks both an in-memory `readOnly` `Ref` and durable `event_log_meta.read_only`, but the `EventLogFull` catch path only latched the `Ref`.
- `packages/core/src/runtime/event-log.ts` — `initialize` creates `event_log_meta(namespace, next_event_id, read_only)` and `readMeta` treats `read_only = 1` as append-deny state.
- `packages/core/src/runtime/event-log.test.ts` — existing coverage proves manually setting `read_only = 1` fails append and preserves query results.
- `packages/core/src/runtime/sqlite.ts` — failed transactions roll back before returning the typed SQLite failure to callers, so the metadata write must happen after the failed append transaction.
- `engineering/learnings/2026-05-06-eventlog-service-retention-ring.md` — EventLog must transition into read-only state on `SQLITE_FULL`; returning a single typed error is insufficient.

## First principles

- Primitive fact: once SQLite says append is unsafe because storage is full, the log must stop attempting writes.
- Invariant: committed events remain queryable.
- Invariant: future appends fail closed until an explicit recovery path exists.
- Constraint: metadata writes can also fail under disk-full pressure, so they cannot replace the original `EventLogFull` failure.
- Source of truth: `event_log_meta.read_only` is the only state that survives reopen.

## Game board

- EventLog wants a cheap local latch; the system wants durable incident state.
- App code may retry after restart; restart must not clear the unsafe append condition.
- Future maintainers are tempted to handle `SQLITE_FULL` as a one-call error; the test must make the restart boundary visible.

## Handoff

Handoff: `/architect`
