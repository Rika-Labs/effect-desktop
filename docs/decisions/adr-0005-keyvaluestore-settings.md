# ADR-0005: Replace bespoke Settings with KeyValueStore.layerSql (T04)

## Status

Accepted

## Context

`packages/core/src/runtime/settings.ts` implements a typed key-value store with custom persistence semantics: writes, reads, atomic updates, and key namespacing. Effect v4 added `KeyValueStore.layerSql` under `effect/unstable/persistence` — a SQLite-backed key-value layer with schema validation built in.

The bespoke service duplicates persistence semantics that the upstream module already owns. Every settings consumer learns a custom shape. Migration between settings schema versions has no documented strategy; ad-hoc shape coercion has been the pattern.

The `KeyValueStore.layerSql` layer depends on `SqlClient` from T02 and uses `FileSystem`/`Path` from T03 to resolve the database location.

## Decision

Delete the bespoke Settings implementation. Adopt `KeyValueStore.layerSql` from `effect/unstable/persistence` as the storage layer.

- Schemas continue to live in user code via `Schema.Class`.
- A thin Settings overlay wraps `KeyValueStore` with typed `get`/`set` using schema validation and key namespacing (prefix convention preserved from the bespoke implementation).
- Migrations between schema versions are explicit transforms applied at read or write, surfaced as `Settings.migrate(from, to, transform)` — no implicit shape coercion.
- Path resolution uses `FileSystem` and `Path` from T03 to locate the settings database in the OS config directory.
- `KeyValueStore.layerSql` depends on `SqlClient` from T02; both are provided at the spine.

Cross-links: [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (SqlClient backing), [ADR-0004](adr-0004-platform-bun.md) (FileSystem and Path for location resolution).

## Alternatives considered

**Keep bespoke**: works today but has no migration story and forces every consumer to learn a custom shape. Rejected.

**Use `BrowserKeyValueStore` for runtime settings**: that primitive targets the browser renderer, not the Bun runtime. Wrong backing. Rejected.

**File-based JSON settings**: no schema validation, no atomic updates, no migration primitives. Rejected.

## Consequences

**Positive**

- `KeyValueStore` tag is standard; the layer is one line of composition.
- Schema validation rejects malformed values at the storage boundary, not at read sites.
- Migrations are visible in user code, not buried in storage internals.

**Negative**

- `effect/unstable/persistence` is beta; `KeyValueStore.layerSql` API may shift before stable.
- Existing settings databases need a one-time migration if key encoding changes between the bespoke and upstream formats.

**Neutral**

- The Settings overlay is thin and local to the framework — if the upstream API changes, the overlay absorbs the change.

## Validation

A `Schema.Class` settings definition reads and writes through the typed overlay backed by `KeyValueStore.layerSql`; schema validation rejects malformed values; key namespaces survive a round-trip; `bun run typecheck` and `bun test` pass with no reference to the deleted bespoke `runtime/settings.ts`.

## Migration notes

1. Delete `packages/core/src/runtime/settings.ts`.
2. Add `effect/unstable/persistence` to `packages/core`.
3. Add `KeyValueStore.layerSql` to the runtime spine, depending on `SqlClient` (T02).
4. Implement the Settings overlay with typed `get`/`set` and the key-prefix convention.
5. Document the one-time key-encoding migration for any existing settings databases.
