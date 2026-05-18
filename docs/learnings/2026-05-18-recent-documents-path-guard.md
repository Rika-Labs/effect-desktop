---
title: Recent documents path guard
date: 2026-05-18
---

# Recent documents path guard

Recent-document writes are OS-visible document history. A path accepted at this
boundary should already be an absolute platform path, not a relative path or a
dot-segment string that depends on later normalization.

This slice tightens `RecentDocuments` path validation without changing the wire
shape. `RecentDocuments.add`, list results, and events now require absolute
platform paths with no Unicode control characters and no `.` / `..` path
segments. The Rust host route applies the same syntactic guard before failing
closed as typed unsupported.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host recent_document --bin host`
- `bun test packages/native/src/index.test.ts -t 'RecentDocuments bridge client accepts safe absolute document paths|RecentDocuments bridge client rejects invalid paths before transport|RecentDocuments bridge client sends typed host envelopes'`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'RecentDocuments|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. `RecentDocuments` is the durable
OS recent-document boundary and is not a thin Effect wrapper. Remaining #1339
debt is still the real native adapter: macOS, Windows, and Linux document-list
state, host-originated events, permission/audit behavior around OS state
changes, and host-backed platform tests.
