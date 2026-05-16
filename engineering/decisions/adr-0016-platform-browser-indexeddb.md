# ADR-0016: Adopt @effect/platform-browser IndexedDB modules in the renderer (T18)

## Status

Accepted

## Context

The renderer has zero `@effect/platform-browser` integration. Apps that want typed storage lighter than a full WASM SQLite payload must hand-wire raw IndexedDB — no schema validation, no versioned migrations, no Effect-native API.

`@effect/platform-browser` ships `IndexedDbTable`, `IndexedDbVersion`, `IndexedDbMigration`, `IndexedDbDatabase`, `IndexedDbQuery`, `BrowserKeyValueStore`, and `BrowserContext.layer`. The `IndexedDb*` modules integrate directly with `Model.Class` — the same definitions used for SQL storage work for IndexedDB tables. `BrowserKeyValueStore` covers non-schema config (theme preference, last window position, etc.).

T17 (`@effect/sql-sqlite-wasm`, [ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md)) uses `@effect/platform-browser` as its IndexedDB backing when OPFS is unavailable. T18 therefore is a dependency of T17.

## Decision

Add `@effect/platform-browser` as a renderer dependency. Provide `BrowserContext.layer` from `DesktopProvider`.

- `DesktopProvider` mounts `BrowserContext.layer` so any service in the renderer's `MainLayer` (T20) can consume browser-platform capabilities.
- `IndexedDbTable` and `IndexedDbVersion` are exposed for use with shared `Model.Class` definitions.
- `IndexedDbMigration` runs at layer boot when the schema version changes; no manual migration management.
- `BrowserKeyValueStore` is exposed for non-schema config.
- T17's `@effect/sql-sqlite-wasm` uses this layer as its IndexedDB backing where OPFS is unavailable — no separate wiring needed.

Template use-cases documented: draft state surviving reload, offline outbox for optimistic mutations, cross-tab persistence, simple key-value config.

Cross-links: [ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md) (WASM SQLite uses this layer as IndexedDB fallback), [ADR-0017](adr-0017-pglite-renderer.md) (PGlite also uses this layer for its backing store).

## Alternatives considered

**Hand-roll IndexedDB per app**: no schema validation, no `Model.Class` integration, no versioned migrations. Each app reinvents the same primitives. Rejected.

**Use `localStorage` for all renderer config**: synchronous, size-limited, no schema validation, not observable by Effect fibers. Appropriate only for trivial string values; insufficient for structured app state. Rejected.

**Only adopt when T17 is needed**: T18 is also useful independently (draft state, offline outbox, key-value config). Adopting now rather than as a T17 side effect makes the dependency explicit. Adopted.

## Consequences

**Positive**

- Typed, schema-validated IndexedDB storage available without the full WASM SQLite payload.
- `BrowserContext.layer` covers browser-platform services for all renderer code in one layer.
- `IndexedDbMigration` makes schema evolution explicit and version-tracked.

**Negative**

- `@effect/platform-browser`'s `IndexedDb*` APIs are newer; any API churn hits the renderer directly.
- IndexedDB performance and quota limits still apply; not appropriate for large datasets (use WASM SQLite for those).

**Neutral**

- Cross-tab change notification beyond what `BrowserKeyValueStore` already provides is out of scope.

## Validation

A renderer template using `IndexedDbTable` declared from a shared `Model.Class` persists a row, reloads, and reads it back without hand-rolled IndexedDB; a migration that adds a column at version bump runs at layer boot without manual intervention; `BrowserKeyValueStore` round-trips a non-schema config value across reload.

## Migration notes

1. Add `@effect/platform-browser` to `packages/react`.
2. Mount `BrowserContext.layer` in `DesktopProvider`.
3. Expose `IndexedDbTable`, `IndexedDbMigration`, and `BrowserKeyValueStore` from `packages/react`.
4. Add renderer template examples for each documented use-case.
5. Confirm T17 and T19 resolve their IndexedDB backing from this layer automatically.
