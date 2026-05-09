# ADR-0017: Add optional renderer Postgres via @effect/sql-pglite (T19)

## Status

Proposed

## Context

Some desktop apps need capabilities beyond SQLite: full-text search with `tsvector`, JSON operators, and pgvector embeddings for AI features. Without local Postgres in the renderer, every vector similarity search and full-text query requires a round-trip through the runtime bridge — adding IPC latency and framework coupling to a renderer concern.

`@effect/sql-pglite` ships PGlite (Postgres in WASM, under 3 MB gzipped with pgvector built in). It exposes the same `SqlClient` API as `@effect/sql-sqlite-bun` (T02) and `@effect/sql-sqlite-wasm` (T17). The same `Model.Class` definitions work across all three.

T17 (WASM SQLite, [ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md)) is the default renderer persistence layer. PGlite is heavier and Postgres-specific. The default bundle must not pay the PGlite cost; the feature is opt-in.

Status is **Proposed** rather than **Accepted** because the PGlite WASM payload size and pgvector correctness in a WebView context must be validated before committing to v1 delivery. This ADR records the intent and design; adoption is gated on that validation.

## Decision (proposed)

Add `@effect/sql-pglite` as an optional renderer dependency, gated behind a spine flag.

- `Desktop.app({ renderer: { sql: "pglite" } })` (T20) triggers inclusion of `PgliteClient.layer({ ... })` in the renderer's `MainLayer`.
- When the flag is unset, PGlite WASM does not appear in the renderer bundle.
- The same `Model.Class` definitions shared across T02 and T17 compile against `PgliteClient` without modification.
- T17 (WASM SQLite) ships first as the default; PGlite is the explicit heavier opt-in.
- Templates demonstrate pgvector similarity queries and `tsvector`-backed full-text search against locally persisted data.

Cross-links: [ADR-0015](adr-0015-sql-sqlite-wasm-renderer.md) (T17 is the default; T19 is the explicit heavier alternative), [ADR-0016](adr-0016-platform-browser-indexeddb.md) (backing store layer shared with T17), [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (shared Model.Class definitions).

## Alternatives considered

**Always bundle PGlite**: penalizes apps that do not need Postgres with a significant WASM payload. The opt-in flag is required. Rejected.

**Round-trip vector search through the runtime**: adds IPC latency to a per-query operation; couples renderer AI features to runtime availability. Rejected for apps where local search is the point.

**Use a third-party WASM SQLite with pgvector extension**: no `SqlClient` integration; breaks `Model.Class` sharing; requires bespoke query adapters. Rejected.

## Consequences

**Positive**

- pgvector and full-text search run locally in the renderer with no IPC hop — latency-critical for AI features.
- Same `Model.Class` works across runtime, WASM SQLite, and PGlite — no schema duplication.
- Opt-in flag keeps the default bundle unaffected.

**Negative**

- PGlite WASM is heavier than WASM SQLite; enabling the flag meaningfully increases the renderer bundle size.
- PGlite correctness in a WebView-sandboxed context (especially on macOS/iOS WKWebView) requires validation before promotion to Accepted.
- Multi-database support and encrypted-at-rest are out of scope; apps needing those must use a different approach.

**Neutral**

- Sync or replication between PGlite and a server-side Postgres is a separate concern not addressed here.

## Validation gate (before Accepted)

With the flag off, PGlite WASM must not appear in the renderer bundle — confirmed via bundle inspection. With the flag on, a pgvector similarity query and a `tsvector` full-text search must run end to end in the renderer template against locally persisted data. The same `Model.Class` definitions used for T17 must compile against `PgliteClient` without modification.

## Migration notes

1. Add `@effect/sql-pglite` as an `optionalDependency` (or `peerDependency` with `peerDependenciesMeta.optional = true`) in `packages/react`. Listing it under `devDependencies` would cause downstream consumers to fail at build/runtime when `renderer.sql === "pglite"` is enabled — `devDependencies` are not installed for dependents. The package must resolve in consumer installs whenever the flag is on.
2. Implement `PgliteClient.layer` wiring gated on `renderer.sql === "pglite"` in the spine.
3. Add pgvector and full-text search examples to renderer templates.
4. Run bundle-size validation; document results in this ADR before changing status to Accepted.
