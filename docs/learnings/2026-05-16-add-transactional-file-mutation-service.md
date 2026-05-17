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

The issue sketched a narrow Effect service with Schema contracts and a native adapter. The shipped shape kept that boundary and now includes a Rust host adapter that prepares from real file bytes, stores commit-capable state in a process-local registry, rejects stale commits, and applies replacements only after the reviewed source hash still matches.

The memory client became more than a fixture. It is the deterministic substitute that proves the lifecycle contract: prepare exposes a diff, commit checks the original source hash, rollback removes prepared state, and event streams report terminal states.

## Why it mattered

The invariant was that a prepared mutation is only valid for the exact source bytes it reviewed. That invariant has to live inside the primitive, not in every caller, because the caller is the actor most tempted to skip a stale-source check when the write looks small.

The platform review found a path policy mismatch: TypeScript rejected UNC paths while Rust accepted them as absolute. Aligning both sides to reject UNC paths avoided a split-brain contract where pre-transport validation and host validation disagreed.

A later platform pass found two lifecycle bugs that the happy-path tests missed. Prepared mutations need an owner scope, and commits need to claim mutation state before calling the host. Without those two facts in the primitive, abandoned prepared state can outlive its actor and concurrent commits can race through the same mutation id.

The merge gate also caught a false completion signal: a protocol plus TypeScript layer is not enough when the issue promises a runtime primitive. If a feature crosses the native boundary, the Rust host path must either implement the behavior or the issue must be narrowed before shipping.

The second merge gate found that support metadata is part of the runtime contract. A host adapter that returns supported while the native capability matrix says unsupported is a split-brain interface; callers cannot reason about availability. It also caught the Windows replace detail: atomic replacement is platform behavior, not an implementation footnote.

The final platform gate caught the same class of bug in both directions: a Windows drive path is not absolute on Unix, and a current-drive-rooted `/...` path is not absolute enough on Windows. Cross-platform path grammar must be platform-conditioned before any file read or replacement can be called supported.

The cancellation gate found that host-prepared and locally claimed states are both resources. If prepare is interrupted after host state creation, local `ResourceRegistry` ownership still has to be installed or the host state has to be rolled back. If commit or rollback is interrupted before the host side effect begins, the primitive must restore the claim; once a host terminal call begins, the call and local cleanup must finish as one uninterruptible terminal section.

The final resource gate found an id ownership bug: when a registry accepts an explicit id request, the returned handle is still the source of truth because collision fallback can change the id. Cleanup must follow the actual handle id, not the requested id.

The final host gate found a stale-source gap between the source hash check and the platform replacement call. The host now captures the reviewed source out of the destination path, validates the captured file, and installs the replacement with an atomic create that fails if another writer recreated the destination path, so a late source change becomes a conflicted mutation instead of a silent overwrite.

## Architecture-debt sweep

No wrapper debt was found in the touched transactional mutation area. The service is not a thin wrapper over Effect or raw filesystem calls; it owns durable desktop policy for mutation identity, owner-scoped prepared state, state transitions, stale-source conflict checks, permission/audit ordering, typed events, and host replacement semantics. No follow-up issue was opened.

## Example

```ts
Effect.gen(function* () {
  const prepared = yield* service.prepare({
    path: "/workspace/notes.md",
    expectedSourceHash,
    replacementBytes: updatedBytes,
    actor
  })

  // Commit must re-check the source hash; the prepared diff is not authority.
  yield* service.commit({ mutationId: prepared.mutationId, actor })
})
```

## Rule candidate

When a primitive has pre-transport validation and host validation, add at least one cross-boundary regression for the path or identifier grammar. Why: security policy drift is most likely at native/web boundary seams.

When a primitive stores commit-capable prepared state, register that state in `ResourceRegistry` and make terminal operations claim the state atomically before external side effects. Why: lifecycle ownership and duplicate-call exclusion are part of the security boundary, not fixture details.

When a prepared or claimed state guards an external side effect, test interruption on both sides of the side-effect boundary. Why: cancellation before the boundary should restore state, while cancellation after the boundary should not expose unowned host state or a half-terminal local state.

When a registry returns a handle, store the returned handle id even if an explicit id was requested. Why: explicit ids are requests, while handles are ownership facts.

When a host commit guards a file replacement with a source hash, make the write path fail if the destination changes after validation. Why: every gap between validation and the replacement is a stale-overwrite window.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it — `/learn` never auto-edits AGENTS.md.
