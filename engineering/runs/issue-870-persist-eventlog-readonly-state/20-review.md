## Findings

No blocking architecture findings.

## Reality check

- The metadata write must occur after the failed append transaction, not inside it, or rollback will erase the read-only latch.
- Returning the original `EventLogFull` is the least surprising contract; replacing it with metadata-write failure would hide the append failure that caused the state transition.
- A private helper is enough. A public recovery API, extra error variant, or SQLite port change would exceed the issue.
- The regression needs a real SQLite database path so reopen observes durable state, but the full condition can be injected at the SQLite port boundary for determinism.

## Locked architecture

Add a private EventLog metadata update in the `EventLogFull` catch path, keep the in-memory latch, preserve the original typed failure, and cover the restart boundary with a deterministic SQLite-full injection test.

Handoff: `/work`
