---
date: 2026-05-16
type: in-flight-feature
topic: Add transactional file mutation service
issue: https://github.com/Rika-Labs/effect-desktop/issues/1383
pr: none
---

# Add transactional file mutation service

## Decision

A file mutation primitive should own prepare/commit/rollback identity, conflict detection, permission ordering, audit, and events directly; otherwise callers end up rebuilding the unsafe write policy the primitive exists to remove.

## What changed

The issue sketched a narrow Effect service with Schema contracts and a native adapter. The shipped shape kept that boundary, but made the host fail closed until a real native adapter exists: malformed input is rejected before transport, supported status is explicit, and unsupported host behavior is a typed failure rather than a no-op.

The memory client became more than a fixture. It is the deterministic substitute that proves the lifecycle contract: prepare exposes a diff, commit checks the original source hash, rollback removes prepared state, and event streams report terminal states.

## Why it mattered

The invariant was that a prepared mutation is only valid for the exact source bytes it reviewed. That invariant has to live inside the primitive, not in every caller, because the caller is the actor most tempted to skip a stale-source check when the write looks small.

The platform review found a path policy mismatch: TypeScript rejected UNC paths while Rust accepted them as absolute. Aligning both sides to reject UNC paths avoided a split-brain contract where pre-transport validation and host validation disagreed.

## Example

```ts
const prepared = yield* service.prepare({
  path: "/workspace/notes.md",
  expectedHash,
  contents: updatedBytes,
  actor,
})

// Commit must re-check the source hash; the prepared diff is not authority.
yield* service.commit({ mutationId: prepared.mutationId, actor })
```

## Rule candidate

When a primitive has pre-transport validation and host validation, add at least one cross-boundary regression for the path or identifier grammar. Why: security policy drift is most likely at native/web boundary seams.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
