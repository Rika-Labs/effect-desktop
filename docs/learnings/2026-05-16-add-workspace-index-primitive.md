---
date: 2026-05-16
type: in-flight-feature
topic: Add workspace index primitive
issue: https://github.com/Rika-Labs/effect-desktop/issues/1384
pr: none
---

# Add workspace index primitive

## Decision

Workspace indexing must treat path filtering as a two-stage contract: TypeScript rejects non-canonical syntax before transport, and native adapters must canonicalize real filesystem paths before any read.

## What changed

The issue asked for a product-neutral indexing primitive with Schema contracts, an Effect service, typed failures, permissions, native bridge wiring, Rust host boundaries, tests, docs, and API snapshots. The shipped shape keeps `WorkspaceIndex` narrow: it owns session identity, scoped grant checks, ignore filtering, lifecycle events, audit, and the typed unsupported host boundary.

The review changed the final design. Audit rows now commit before host calls or local index state mutation, refresh re-checks `filesystem.read` after open, fully ignored refreshes do not call the host, and both TypeScript and Rust reject `.` and `..` path segments before transport or unsupported host handling.

## Why it mattered

The important invariant was not "the path string starts with the root." The invariant was "no component reads or indexes outside the granted root." Lexical filtering helps avoid unnecessary host work, but only native canonicalization can make symlink and hard-link behavior safe.

The local incentive was to satisfy root containment in the service because it was close to the ignore filter. That would have created a weak filesystem policy surface. The better mechanism is explicit layering: syntax guards in the service, canonical filesystem policy in the native adapter before real reads.

## Example

```ts
// Service guard: reject ambiguous syntax before transport.
if (!isAbsolutePath(path) || hasDotPathSegment(path) || !isWithinRoot(path, scope.root)) {
  return invalid("changedPaths", "must stay inside the workspace root", "WorkspaceIndex.refresh")
}
```

## Rule candidate

Path security rules that depend on real filesystem identity must live at the boundary that can resolve real paths. Why: lexical TypeScript checks cannot prove symlink or hard-link containment.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
