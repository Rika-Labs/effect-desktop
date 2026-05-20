# ADR-0001: Adopt @effect/platform-bun

## Status

Superseded by #1213. The runtime spine now imports upstream Bun and Node platform
layers inside the provider graph instead of exposing a framework-owned
`BunServicesLayer` wrapper from `@orika/core`.

## Context

Five bespoke runtime services — `filesystem`, `process`, `worker`, `pty`, and the absent `path` — live in `packages/core/src/runtime/`. These services provide two distinct concerns:

1. Desktop-specific behavior: symlink escape detection, permission policy enforcement, process-tree management, budget enforcement, capability authorization, and atomic writes. None of these exist in the upstream platform layer.

2. Accidental duplication of the upstream abstract service tags (`FileSystem`, `Path`, `ChildProcessSpawner`, etc.) that every Effect application knows. Code that wants the standard platform surface must instead learn the bespoke shape of the `Filesystem` context service, which differs from `effect/FileSystem`.

The result is that standard Effect patterns ("yield\* FileSystem.FileSystem") do not work because `BunServices.layer` is not provided at the runtime spine.

`@effect/platform-bun` v4 (versioned alongside `effect` v4 beta) provides `BunServices.layer`, which bundles the standard `FileSystem`, `Path`, `Terminal`, `Stdio`, and `ChildProcessSpawner` services as a single composable layer.

## Decision

Add `@effect/platform-bun@4.0.0-beta.60` (pinned to match `effect@4.0.0-beta.60`) as a dependency of `packages/core`.

Provide `BunServices.layer` in the runtime spine so standard Effect platform tags
resolve for runtime code.

Historical note: this ADR originally introduced
`packages/core/src/runtime/platform.ts` and a `BunServicesLayer` re-export. #1213
removed that zero-policy wrapper. Runtime provider modules now import upstream
platform layers directly.

The desktop-specific bespoke services (`Filesystem`, `Process`, `Worker`, `PTY`) are kept in place. They add real value that does not exist upstream: permission policies, symlink escape detection, atomic writes, process-tree lifecycle, budget enforcement, and capability authorization. The upstream tags and the desktop services are complementary, not substitutes.

PTY has no upstream equivalent in `effect` or `@effect/platform-bun`. It stays as a framework-owned service, framed as the upstream contribution candidate when the Effect ecosystem adds PTY support.

## Alternatives considered

**Delete bespoke services entirely.** The issue's initial framing suggested this, but the bespoke services contain significant desktop-specific logic (symlink escape, permission policy, atomic writes, process tree management) that does not exist upstream. Deletion would require reimplementing that logic in callers, which is worse. Keeping both is consistent with the issue's game board: "Standard `FileSystem` from `@effect/platform` is the only authorized handle" — authorized for new application code, not a requirement to remove the internal security layer.

**Keep bespoke services and skip adoption.** Leaves the standard surface unprovided. New code written by Effect-literate contributors cannot use `FileSystem.FileSystem` without a live implementation.

## Consequences

- The selected upstream provider layer must be provided at the runtime spine for standard platform tags to resolve. The existing `FilesystemLive` layer continues to provide the desktop `Filesystem` context service independently.
- Every future version bump of `@effect/platform-bun` must be coordinated with the corresponding `effect` version bump.
- PTY remains a framework deviation until upstream supports it.

## Validation

`bun run typecheck` passes with no errors across all packages. `bun test` passes 282 tests. `bun run lint` and `bun run format:check` pass clean.

## Migration notes

Consumers should import standard platform tags from Effect packages directly.
Effect Desktop owns provider selection, not a parallel platform-tag re-export
surface.
