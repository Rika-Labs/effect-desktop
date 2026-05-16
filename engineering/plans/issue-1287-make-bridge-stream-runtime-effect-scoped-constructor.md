# Issue #1287: Make Bridge Stream Runtime an Effect-Scoped Constructor

## Objective

Make bridge stream runtime construction an Effect-scoped acquisition instead of a synchronous runtime factory. Stream producers already live in `FiberMap` and stream state already lives in `SubscriptionRef`; the constructor should expose that resource shape directly instead of hiding it behind `Scope.makeUnsafe` and `Effect.runSync`.

## Pre-change Shape

- `Streams(...)` returns a `BridgeStreamRuntime` synchronously.
- `Streams.withOptions(...)` returns a `BridgeStreamRuntime` synchronously.
- `makeActiveBridgeStreams()` creates an owned unsafe scope, then uses `Effect.runSync` to allocate `FiberMap` and `SubscriptionRef`.
- `resolveOptions()` uses `Effect.runSync(makeBridgeStreamRegistry(...))` when callers do not provide a registry.
- Tests acquire runtimes outside an Effect scope, then manually call `runtime.dispose()` only in selected cases.

## Target Shape

- Replace the callable `Streams` factory with an object exposing:
  - `Streams.scoped(...layers)`
  - `Streams.scopedWithOptions(options, ...layers)`
- Both constructors return `Effect.Effect<BridgeStreamRuntime<Env>, never, Scope.Scope>`.
- `FiberMap.make`, `SubscriptionRef.make`, and default `makeBridgeStreamRegistry` allocation happen through `yield*`.
- The caller's scope owns runtime finalization with `Scope.addFinalizer(scope, runtime.dispose())`.
- `runtime.dispose()` remains as an explicit early-close operation and shares the same cleanup path as scope finalization.

## Architecture Debt Sweep

Remove now:

- The synchronous `Streams(...)` and `Streams.withOptions(...)` custom constructor surface.
- Unsafe local scope ownership in `packages/bridge/src/streams.ts`.
- `Effect.runSync` allocation in stream runtime construction.

Keep:

- `BridgeStreamRuntime` itself, because it owns bridge-specific protocol dispatch: request envelope validation, stream id allocation, terminal frames, backpressure policy, cancellation envelopes, and registry state visible to devtools.
- Bridge stream frame schemas and registry APIs, because those are protocol and observability contracts rather than thin Effect wrappers.

No follow-up issue is expected for the touched stream runtime area unless implementation uncovers another wrapper that only mirrors Effect primitives.

## Verification

- Focused:
  - `bun test packages/bridge/src/streams.test.ts`
  - `rg -n "Scope\\.makeUnsafe|Effect\\.runSync" packages/bridge/src/streams.ts`
  - `rg -n "Streams\\(|Streams\\.withOptions" packages/bridge/src packages/core/src packages/devtools/src packages/react/src packages/solid/src packages/vue/src apps templates tests`
- API:
  - `bun packages/cli/src/bin.ts check --api --write`
- Full before push:
  - `bun run format:check`
  - `git diff --check`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun packages/cli/src/bin.ts check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Changing bridge stream frame wire format.
- Replacing the existing bridge backpressure policies.
- Replacing `BridgeRpc` itself; that larger adapter sweep is tracked separately.
