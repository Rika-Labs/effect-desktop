# Milestone 11: Filesystem

Tracks `docs/SPEC.md` §24.11 and GitHub issue #95. Format follows the
repo milestone convention and includes the §28.4 completion report.

## Goal

Provide the core runtime `Filesystem` service for typed file operations,
watchers, path policies, and capability-gated filesystem access.

## Non-goals

Per §24.11:

- do not expand public API beyond the milestone;
- do not introduce product-specific concepts;
- do not skip tests because later milestones will add tests;
- do not solve cross-platform polish before the primitive is validated.

Specifically deferred from this phase: the Phase 16 dynamic
`PermissionRegistry` lifecycle and approval broker, release documentation pages,
cross-platform desktop polish, and a reusable in-memory filesystem test harness.

## Required files

- `packages/core/src/runtime/filesystem.ts` and
  `packages/core/src/runtime/filesystem.test.ts`.
- `packages/core/src/index.ts` for the public core export.
- Learning records for issues #97, #98, #99, #100, and #101.

## Public APIs

`@effect-desktop/core` exports:

- `Filesystem` / `FilesystemLive` / `makeFilesystem` for typed
  `read/write/writeAtomic/stat/mkdir/remove/realpath/watch` operations.
- `FilesystemApi`, `FilesystemError`, `FilesystemAdapter`, and
  `FilesystemPermissionPolicy` for substitutable runtime wiring and tests.
- `FilesystemStatResult` and `FilesystemEvent` structured result values.

## Acceptance criteria

From §24.11:

- [x] `read/write/watch` works.
- [x] policy denial works.
- [x] watcher cleanup works.

## Appendix C verification rows

```txt
Requirement: C.36 Filesystem write requires scoped permission.
Test file: packages/core/src/runtime/filesystem.test.ts
Command: bun test packages/core/src/runtime/filesystem.test.ts
Result: pass locally before the phase-close PR and covered by CI.
Notes: Tests assert writes outside configured roots return PermissionDenied,
recursive remove requires explicit delete authority plus the recursive flag, and
permission failures happen before adapter activity.
```

```txt
Requirement: Symlink and hard-link escapes are rejected.
Test file: packages/core/src/runtime/filesystem.test.ts
Command: bun test packages/core/src/runtime/filesystem.test.ts
Result: pass locally before the phase-close PR and covered by CI.
Notes: Tests assert canonicalized symlink targets outside allowed roots and
hard-linked files return SymlinkEscapesRoot.
```

## Validation commands

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run lint
bun run lint:types
bun run format:check
bun test
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo test --workspace
```

Specialized Phase 11 evidence:

- `packages/core/src/runtime/filesystem.test.ts` covers typed read/write/stat,
  mkdir/remove, invalid input, typed file-not-found, permission-denied, disk-full
  mapping, atomic write preservation and temp cleanup, canonical realpath checks,
  symlink and hard-link escape denial, watcher event delivery, watcher async
  error routing, and watcher disposal on scope close.
- CI validated implementation PRs #201 through #205 on Blacksmith Ubuntu,
  Windows, and macOS runners before merge.

## Completion report

```txt
Milestone: Phase 11 - Filesystem
Files changed: core Filesystem service, adapter, tests, public export, and Phase
11 learning records.
Public APIs added: @effect-desktop/core Filesystem, FilesystemLive,
makeFilesystem, FilesystemApi, FilesystemAdapter, FilesystemPermissionPolicy,
FilesystemStatResult, and FilesystemEvent.
Tests added: Filesystem runtime tests for basic operations, watcher lifecycle,
capability roots, atomic writes, and path normalization / symlink policy.
Validation commands run: bun install --frozen-lockfile; bun run check; bun run
typecheck; bun run lint; bun run lint:types; bun run format:check; bun test;
cargo fmt --check; cargo clippy --workspace --all-targets -- -D warnings; cargo
check --workspace; cargo test --workspace.
Validation results: all pass locally on the phase-close branch; Phase 11
implementation PRs #201 through #205 were green in Blacksmith CI before merge.
Known limitations: the Phase 11 policy is static service configuration until
Phase 16 wires dynamic capability lifecycle and approval prompts; release docs
and example coverage remain later release-readiness work.
Follow-up items: Phase 16 integrates the dynamic PermissionRegistry, Phase 20
can add a reusable filesystem mock, and Phase 24 owns final release docs and API
snapshot coverage.
```

## Completion notes

Phase 11 shipped as five implementation PRs plus this closure PR:

- #201 added the typed `Filesystem` service surface with schema validation,
  trace spans, a narrow adapter, and typed `HostProtocolError` mapping.
- #202 added `Filesystem.watch` as a scope-bound stream subresource registered
  with `ResourceRegistry`, including typed asynchronous watcher failures.
- #203 added static capability-root policy for read/write/delete operations and
  recursive remove gating.
- #204 added `Filesystem.writeAtomic` with sibling temp files, synced writes,
  rename commit, and temp cleanup on failure.
- #205 added canonical path authorization, `Filesystem.realpath`, symlink escape
  denial, and conservative hard-link denial.

The durable lesson from the phase is that filesystem safety is an ordering
problem. The service must validate input, canonicalize the path, compare the
canonical result against declared authority, then touch disk. Reordering those
steps can turn familiar filesystem helpers into privilege bypasses.
