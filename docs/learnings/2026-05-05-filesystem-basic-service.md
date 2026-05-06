---
date: 2026-05-05
type: in-flight-feature
topic: "Filesystem service: read, write, stat, mkdir, remove with typed errors"
issue: https://github.com/Rika-Labs/effect-desktop/issues/97
pr: https://github.com/Rika-Labs/effect-desktop/pull/201
---

# Filesystem service: read, write, stat, mkdir, remove with typed errors

## What we set out to do

Phase 11 needed the first `Filesystem` service surface in `@effect-desktop/core`: `read`, `write`, `stat`, `mkdir`, and `remove` as Effect operations with schema-validated inputs, trace spans, and structured `HostProtocolError` failures. The issue deliberately left capability checks, symlink policy, watchers, and atomic writes to sibling issues so this step could establish the basic service boundary without solving the whole filesystem model at once.

## What actually ended up working

The shipped design matches the planned architecture: `makeFilesystem` builds a substitutable service over a narrow filesystem adapter, validates every public input with `Schema.Class`, wraps each operation in `Effect.withSpan`, and maps Node/Bun filesystem failures into the bridge error registry. The public API is exported from `packages/core/src/index.ts`, while the adapter hides `node:fs/promises` and one platform-specific wrinkle: non-recursive `remove` uses `stat` plus `rmdir` or `unlink` instead of forcing `rm(path, { recursive: false })`.

```mermaid
flowchart LR
  AppCode["App Effect code"] --> FS["Filesystem service"]
  FS --> Schema["Schema validation"]
  Schema --> Span["Effect span"]
  Span --> Adapter["filesystem adapter"]
  Adapter --> NodeFs["node:fs/promises"]
  NodeFs --> ErrorMap["HostProtocolError mapping"]
```

## What surfaced in review

Two PR review threads were addressed. Both pointed at the same boundary mistake: `Filesystem.stat` and non-recursive `Filesystem.remove` originally used following `stat`, which hid symlink identity. The fix switched the default adapter's stat path and remove classification to `lstat`, then added regression tests for symlink stat results and directory-symlink removal.

## First-principles postmortem

The invariant that mattered most was that native filesystem failure must be data in the Effect error channel, not an exception path. Filesystem APIs throw because the operating system reports failures through imperative calls; the framework boundary has to absorb that shape and return typed values. The useful abstraction is not "a wrapper around fs"; it is "a typed failure translator plus validation boundary" with a small adapter underneath.

## Game-theory postmortem

The app author's local incentive is to import `node:fs/promises` directly because it is easy and familiar. The mechanism that changes the equilibrium is a first-class `Filesystem` service whose failure tags are usable with `Effect.catchTag` and whose adapter is substitutable in tests. That makes the correct path cheaper than bespoke filesystem calls while preserving later enforcement points for capabilities, symlink policy, watchers, and atomic writes.

## Non-obvious lesson

Bun's Node compatibility and filesystem link semantics can both diverge at edges that look harmless. On this platform, forcing a non-recursive remove option produced an `EFAULT` from `fs.rm`, while expressing the primitive directly as `lstat` plus `rmdir` or `unlink` avoided the failure and preserved symlink identity. The deeper lesson is to model the operation the framework owns, not blindly mirror the host API's option surface or default to following path resolution.

## Reproducible pattern (if any)

When introducing runtime services over throwing platform APIs:

1. Keep the public Effect service narrow.
2. Validate before touching the adapter.
3. Convert platform failures immediately into the closed bridge error registry.
4. Use non-following metadata calls when the public result includes symlink identity.
5. Make the adapter substitutable so hard-to-trigger OS failures can be tested as values.

## AGENTS.md amendment candidate (if any)

Consider adding: when wrapping Node/Bun filesystem APIs, avoid forcing default boolean options unless a test proves the runtime accepts them; Why: compatibility bugs can appear at option edges even when the default behavior is supported.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it -- `/learn` never auto-edits AGENTS.md.
