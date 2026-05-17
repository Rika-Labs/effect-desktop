---
date: 2026-05-17
type: feature
topic: Add durable Job service
issue: https://github.com/Rika-Labs/effect-desktop/issues/1373
pr: None; merged directly to main per local workflow
---

# Add Durable Job Service

## Decision

`Job` is a durable lifecycle ledger with a scoped live-fiber companion, not an arbitrary worker runtime.

## What Changed

The native surface now records long-running work as generation-stamped job handles with typed start, pause, resume, retry, interrupt, succeed, fail, progress, get, support, and event contracts. The TypeScript service owns Schema validation, permission checks, audit rows, bridge clients, and test substitution. `JobRuntime` uses Effect `FiberMap` for live renderer-owned work and writes terminal state when fibers exit. The Rust host owns the durable JSON job store, replaces store files atomically, and emits lifecycle events through the host router.

## Why It Mattered

Long-running work needs observable state before every feature invents its own progress object. A narrow job ledger gives workflows, local tools, and future worker surfaces one stable lifecycle record while `JobRuntime` handles in-process fibers without turning the native host ledger into a generic executor.

## Architecture-Debt Sweep

No wrapper debt was removed in the touched area. The new surface uses `NativeSurface`, `RpcGroup`, Effect `Layer`/`Stream`/`FiberMap`, Schema contracts, `PermissionRegistry`, and the host protocol directly. No custom workflow DSL, bridge DSL, or parallel Effect abstraction was added.

The platform review tightened five invariants before merge: duplicate `jobId` values fail instead of overwriting records, terminal states reject later control or progress mutations, Linux durable state uses the XDG state directory instead of config storage, active jobs are registered with `ResourceRegistry` until a terminal transition disposes them, and successful lifecycle mutations can append to an Effect `EventJournal`.

The main residual scope boundary is deliberate: native host execution remains outside this primitive. Future worker or process surfaces should bind work to `jobId` instead of expanding `Job` into a host-side executor. A direct Rust host-protocol request still depends on the bridge/runtime permission envelope; the host method itself does not own an independent capability registry.
