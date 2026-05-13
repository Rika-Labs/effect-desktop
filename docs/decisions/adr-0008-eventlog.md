# ADR-0008: Replace bespoke event-log with effect/unstable/eventlog (T07)

## Status

Accepted

## Context

`packages/core/src/runtime/event-log.ts` and `audit-events.ts` hand-roll an append-only event journal: persistence, replay, compaction, and listener fan-out are all bespoke. The implementation has no cross-window reactivity integration; notifying live queries after a write requires explicit, error-prone wiring at each call-site.

`effect/unstable/eventlog` ships `EventLog` and `EventJournal` with first-class `Reactivity` integration via `groupReactivity`. A single `EventLog.publish` write automatically invalidates matching reactivity keys ([ADR-0013](adr-0013-reactivity.md)), so cross-window reactive UI updates come for free without manual notify calls.

The runtime tier persists via the SQL adapter from T02 (`SqlClient`); the renderer-side audit surface would persist via IndexedDB from T18.

## Decision

Delete the bespoke `event-log.ts` implementation/wrapper. Adopt
`effect/unstable/eventlog` directly.

- Audit is reframed as a typed `EventGroup` defined once in `packages/core/src/runtime/audit-events.ts` (file stays but its content changes from bespoke to an `EventGroup` value).
- `EventLog` is composed from `EventJournal` plus the audit `EventGroup`. Journal selection (SQL vs IndexedDB) is the only configuration point.
- `groupReactivity` wires each event tag to one or more reactivity keys so every `EventLog.publish` invalidates the correct live queries without explicit wiring at call-sites.
- The runtime journal backend is the `SqlClient` provided by T02.
- Compaction is owned by the upstream `EventJournal`; the bespoke compaction logic is deleted.
- Audit events published by the permission interceptor (T21) flow through the same `EventLog`.

Cross-links: [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (SQL journal backend), [ADR-0013](adr-0013-reactivity.md) (groupReactivity connects to the Reactivity bus), [ADR-0016](adr-0016-platform-browser-indexeddb.md) (renderer-side journal backend).

## Alternatives considered

**Keep bespoke**: forfeits the `groupReactivity` integration; cross-window reactive updates require manual wiring at every write site. Rejected.

**Roll a custom reactivity bridge**: more code, same outcome as upstream provides natively. Rejected.

**Wait for stable**: the `groupReactivity` integration is the architectural linchpin for the T15 Reactivity story. Delaying blocks T15 and T16. Rejected.

## Consequences

**Positive**

- Cross-window reactivity is automatic: `EventLog.publish` → `groupReactivity` → `Reactivity.invalidate` → live query re-emits.
- Compaction, replay, and storage are owned by the upstream module; no framework maintenance.
- Audit events are typed `EventGroup` members with versioned schemas; schema drift is a compile error.

**Negative**

- `effect/unstable/eventlog` is beta; `groupReactivity` API may shift.
- Existing audit consumers must migrate to the `EventGroup`-based API.

**Neutral**

- Audit event tag names are preserved as `EventGroup` tag identifiers; consumers that subscribe by name compile without changes after the migration.

## Validation

Journal entries persist across restart via the SQL adapter; a renderer-side live query subscribed via Reactivity invalidates within one tick of a publish in another window; compaction reduces journal size under a synthetic workload; no public `@effect-desktop/core` wrapper re-export remains for upstream EventLog primitives. `bun run typecheck` and `bun test` pass.

## Migration notes

1. Delete `packages/core/src/runtime/event-log.ts` bespoke persistence/replay/compaction logic.
2. Rewrite `audit-events.ts` to export a typed `EventGroup` value.
3. Add `effect/unstable/eventlog` to `packages/core`.
4. Wire `EventLog` + `EventJournal` (SQL backend) in the spine layer.
5. Configure `groupReactivity` with the audit event tags mapped to their reactivity keys.
6. Migrate existing audit publish call-sites to `EventLog.publish`.
