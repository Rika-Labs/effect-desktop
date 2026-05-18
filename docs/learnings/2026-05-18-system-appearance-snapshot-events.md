---
title: SystemAppearance snapshot events
date: 2026-05-18
---

# SystemAppearance snapshot events

The SystemAppearance event contract carried only `{ appearance }`, while the
issue requires change events to carry the same state shape as the initial
snapshot. A renderer that receives an event without accent color, reduced
motion, or reduced transparency would need to guess or race separate reads.

This slice makes `SystemAppearanceChangedEvent` a complete snapshot:
`appearance`, `accentColor`, `reducedMotion`, and `reducedTransparency`.
Host runtime support remains fail-closed and unsupported until native OS
watchers exist.

Verification:

- `cargo fmt --check`
- `git diff --check`
- `cargo test -p host-protocol system_appearance --lib`
- `cargo test -p host system_appearance --bin host`
- `cargo test -p host host_dispatch_registry_covers_host_protocol_methods --bin host`
- `bun test packages/native/src/capabilities.test.ts packages/native/src/parity-matrix.test.ts packages/native/src/index.test.ts -t 'SystemAppearance|NativeCapabilities|NativeParityMatrix'`
- `bun x tsc --noEmit -p packages/native/tsconfig.json --pretty false`
- `bun x tsc --noEmit -p packages/react/tsconfig.json --pretty false`
- `bun desktop check --api`

Architecture-debt sweep: no wrapper removed. The public SystemAppearance Effect
service is the durable UI state boundary; the Rust structs describe the native
wire contract. Remaining debt is the real host adapter: platform snapshot
reads, OS change watchers, stream lifecycle policy, diagnostics visibility, and
host-backed success/unsupported/failure tests.
