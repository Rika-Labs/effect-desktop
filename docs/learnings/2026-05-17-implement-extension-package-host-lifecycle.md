---
date: 2026-05-17
type: feature
topic: Implement ExtensionPackage host lifecycle
issue: https://github.com/Rika-Labs/effect-desktop/issues/1397
pr: None; merged directly to main per local workflow
---

# Implement ExtensionPackage host lifecycle

## Decision

Host package lifecycle work should validate the staged bytes and treat post-commit cleanup as best-effort, because the durable store state is the source of truth once it has been written.

## What changed

The planned shape held: TypeScript kept schema, permission, audit, and capability-registration policy while the Rust host adapter took source resolution, revisioned persistence, support probing, and lifecycle events. Review changed the transaction model. Digest and entrypoint checks moved from the mutable source path to the staged content path, directory digests gained explicit path/type/length framing, and update/remove now tombstone old content before saving the store while ignoring cleanup errors after the committed state is durable.

## Why it mattered

The invariant was not "the filesystem has no leftover bytes"; it was "the response cannot lie about the durable package state." Returning failure after `save_store` succeeds creates a split brain for callers: retry logic sees a failed operation, but `list` sees the committed revision. Package ids also needed dot-segment rejection because even a narrow character whitelist can still encode path traversal with `.` and `..`.

## Example

```rust
save_store(&state_path(&root), &store, operation)?;
let _ = remove_path(&old_tombstone, operation);
Ok(UpdateResult { previous_version, revision })
```

## Rule candidate

When a host adapter commits metadata and content separately, define the commit point first and make every post-commit cleanup failure observable through diagnostics or best-effort cleanup, not through a failed response. Why: callers must be able to trust operation results as statements about durable state.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
