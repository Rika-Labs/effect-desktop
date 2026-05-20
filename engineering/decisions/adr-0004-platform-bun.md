# ADR-0004: Adopt @effect/platform-bun and delete five bespoke runtime services (T03)

## Status

Accepted

## Context

Five hand-rolled runtime services — `filesystem`, `process`, `worker`, `path`, and `pty` — reimplement what `@effect/platform` ships abstractly and `@effect/platform-bun` ships concretely:

- `FileSystem` (typed file operations, scope-tracked handles)
- `Path` (typed path manipulation)
- `Command` (subprocess execution)
- `Worker` (web worker management)
- `Terminal` (TTY interaction)

`BunContext.layer` from `@effect/platform-bun` provides all five in one layer. Application code that wants the standard Effect platform surface currently learns bespoke shapes; every Effect release risks drift.

PTY is the exception. `effect/unstable/process` does not expose a PTY primitive; the bespoke PTY service has no upstream equivalent to adopt yet. It is documented as a deviation pending upstream work.

## Decision

Delete `packages/core/src/runtime/{filesystem,process,worker,path}.ts`. Add `@effect/platform-bun` and provide `BunContext.layer` from the runtime spine.

- Every internal use of filesystem, process, worker, path, and terminal imports from `@effect/platform` tags.
- Re-export `FileSystem`, `Path`, `Command`, `Worker`, and `Terminal` from `@orika/core`.
- PTY is retained temporarily as a documented transitional service (`PtyService`) with a tag-based contract. It will be replaced or contributed upstream when `effect/unstable/process` covers the PTY surface.
- The SQLite driver layer (`@effect/sql-sqlite-bun`, T02) and the HTTP server (`BunHttpServer`, T11) both declare `@effect/platform-bun` as a peer dependency and receive `BunContext.layer` from the spine.

Cross-links: [ADR-0003](adr-0003-sql-effect-unstable-sql.md) (SqlClient driver uses Bun FileSystem), [ADR-0005](adr-0005-keyvaluestore-settings.md) (Settings path resolution uses Path from this ADR), [ADR-0012](adr-0012-http-app-protocol.md) (BunHttpServer depends on platform-bun).

## Alternatives considered

**Keep bespoke services**: five surfaces drift from upstream every Effect release. No upstream contribution path. Rejected.

**Adopt `@effect/platform-node`**: the runtime is Bun, not Node. Using the Node platform layer would require polyfills and risks silent incompatibility on Bun-specific APIs. Rejected.

**Keep PTY under the bespoke model permanently**: PTY has no upstream equivalent today. Keeping it temporarily with a documented deviation is the honest position. The ADR records it as transitional.

## Consequences

**Positive**

- One `BunContext.layer` covers five services; no custom initialization logic.
- Application code uses standard `@effect/platform` tags — portable across any Effect-based runtime.
- FileSystem operations get scope-tracked handle disposal from the platform layer.

**Negative**

- PTY remains bespoke until upstream lands a primitive. Maintenance cost is low but real.
- Cross-cutting import migration touches every internal file that imported a bespoke service.

**Neutral**

- `@effect/platform-bun` is a stable package, not `unstable/*`. API risk is lower than other adoptions in this set.

## Validation

`BunContext.layer` is provided once at the runtime spine and every internal use of filesystem, process, worker, path, and terminal compiles against `@effect/platform` tags with no reference to the deleted bespoke files. PTY either uses an upstream primitive or remains as a documented transitional service. `bun run typecheck` and `bun test` pass.

## Migration notes

1. Delete `packages/core/src/runtime/{filesystem,process,worker,path}.ts`.
2. Add `@effect/platform-bun` to `packages/core`.
3. Provide `BunContext.layer` at the runtime spine entry point.
4. Add re-exports of platform tags from `@orika/core`.
5. Audit PTY against `effect/unstable/process`; document the upstream contribution plan if no primitive exists.
