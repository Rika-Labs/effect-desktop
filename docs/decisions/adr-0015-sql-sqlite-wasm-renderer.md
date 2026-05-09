# ADR-0015: Add renderer-side SQLite via @effect/sql-sqlite-wasm (T17)

## Status

Accepted

## Context

The renderer has no first-class persistence story. Apps that want offline-first behavior, draft state, optimistic mutations, or cross-tab consistency must hand-wire `localStorage` or `IndexedDB` and reinvent migrations, schema validation, and query shape.

`@effect/sql-sqlite-wasm` ships full SQLite via `wa-sqlite`, persisted to OPFS or IndexedDB, exposing the same `SqlClient` API as `@effect/sql-sqlite-bun` (T02). Critically, the same `Model.Class` definition that powers runtime SQLite works in the renderer — define the schema once, run it on both sides of the bridge.

Storage preference: OPFS where supported (better performance, less quota pressure); IndexedDB fallback backed by T18 (`@effect/platform-browser`, [ADR-0016](adr-0016-platform-browser-indexeddb.md)). Default payload cost is non-trivial (full WASM SQLite); the feature is opt-in.

## Decision

Add `@effect/sql-sqlite-wasm` as an optional renderer dependency, gated by a feature flag in the spine.

- `Desktop.app({ renderer: { sql: "wasm" } })` (T20) triggers the inclusion of `SqliteClient.layer({ filename })` in the renderer's `MainLayer`.
- When the flag is unset, the WASM package is not bundled.
- Shared `Model.Class` definitions live in a shared package (e.g., `packages/shared`) consumed by both runtime and renderer. One schema declaration drives both processes.
- Migrations are declared via `Model` migrations and run at layer boot.
- Storage prefers OPFS and falls back to IndexedDB (T18 platform-browser layer provides the IndexedDB backing).

Cross-links: [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (shared Model.Class definitions originate here), [ADR-0016](adr-0016-platform-browser-indexeddb.md) (IndexedDB fallback), [ADR-0017](adr-0017-pglite-renderer.md) (T17 is the default; T19 PGlite is the heavier opt-in alternative).

## Alternatives considered

**Hand-wire IndexedDB per app**: no schema validation, no typed repos, no shared definitions with the runtime. Rejected.

**Always bundle WASM SQLite**: penalizes apps that do not need persistence with a non-trivial WASM payload. Opt-in flag is the right model. Rejected.

**Use PGlite as the only renderer DB**: PGlite is heavier and Postgres-specific; many apps need SQLite semantics and a smaller payload. T17 stays the default; T19 (PGlite) is the explicit opt-in.

## Consequences

**Positive**

- Same `Model.Class` definition works on both sides of the bridge — schema divergence is a compile error.
- OPFS gives near-native SQLite performance in the renderer; IndexedDB fallback covers older browsers.
- Offline-first apps, draft state, optimistic mutations, and cross-tab consistency are first-class without bespoke wiring.

**Negative**

- Full WASM SQLite adds bundle weight; opt-in flag mitigates but the weight is real when enabled.
- OPFS availability varies; the fallback path (IndexedDB) is slower and has stricter quota limits.

**Neutral**

- Cross-process replication between runtime SQLite and renderer WASM SQLite is out of scope. If apps need sync, that is a separate R&D ticket.

## Validation

A renderer template declares a `Model.Class` table, writes a row, reloads the page, and reads the row back without any hand-rolled storage code. The same `Model.Class` definition compiles against the runtime's `@effect/sql-sqlite-bun` client without modification. OPFS is selected on supporting browsers; IndexedDB fallback works where OPFS is unavailable.

## Migration notes

1. Add `@effect/sql-sqlite-wasm` as an optional renderer dependency in `packages/react`.
2. Create a shared `packages/shared/src/model/` directory for `Model.Class` definitions.
3. Wire `SqliteClient.layer` into the renderer's `MainLayer` gated on `renderer.sql === "wasm"`.
4. Document OPFS vs IndexedDB selection in the renderer template.
5. Ensure T18 (`@effect/platform-browser`) is provided before T17 boots.
