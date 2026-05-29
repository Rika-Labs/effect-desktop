---
date: 2026-05-16
type: feature
topic: Add realtime media session primitive
issue: https://github.com/Rika-Labs/effect-desktop/issues/1391
pr: none
---

# Add realtime media session primitive

## Decision

Native host validation must mirror the public Schema boundary before returning typed unsupported results; otherwise unsupported adapters can hide malformed inputs.

## What changed

The issue asked for a product-neutral realtime media primitive with Schema contracts, Effect service layers, typed failures, streams, Rust protocol structs, host routing, docs, tests, and API snapshots. The shipped version adds `RealtimeMediaSession` as a narrow native service with profile/session partitioning, replaying event streams, a deterministic memory client, an unsupported client, bridge event decoding, capability metadata, production checks, Rust protocol structs, Rust router coverage, docs, and API snapshot updates.

The architecture-debt sweep found repeated event-aware native bridge client adapters. That debt was not removed in this issue because consolidation belongs in the shared `NativeSurface` helper across multiple event-capable services. Follow-up issue #1393 tracks the before/after.

## Why it mattered

The first platform review found that TypeScript rejected NUL-bearing `profileId`, `sessionId`, and `deviceId` values, while the Rust host only rejected empty strings before returning `Unsupported`. That meant a direct host payload could bypass the public client's exact boundary and receive the wrong typed failure. The invariant is not only "invalid input returns a typed error"; it is "every boundary that can be reached directly enforces the same malformed-input contract before any adapter response."

## Example

```rust
if value.is_empty() {
    return Err(HostProtocolError::invalid_argument(field, "must not be empty", operation));
}
if value.as_bytes().contains(&0) {
    return Err(HostProtocolError::invalid_argument(field, "must not include NUL bytes", operation));
}
```

## Rule candidate

When a TypeScript Schema guards a native payload field, add a Rust host regression for the strongest rejected value, not only the empty value. Why: unsupported host adapters still sit behind a direct protocol boundary and must not become weaker validators than the public client.

This is a proposal. Review and edit AGENTS.md yourself if you want to adopt it - `/learn` never auto-edits AGENTS.md.
