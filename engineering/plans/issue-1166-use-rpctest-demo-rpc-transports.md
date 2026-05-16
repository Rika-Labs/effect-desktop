# Issue #1166: Use RpcTest for Demo RPC Transports

## Objective

Remove fake in-memory RPC transports from demo and adapter tests when they are not asserting bridge envelope behavior. Non-protocol paths should use Effect RPC's `RpcTest.makeClient` through renderer client maps instead of reimplementing request queues, stream fibers, cancellation, and host error translation.

## Current Shape

- `apps/examples/notes-common/src/index.ts` exports `makeNotesDemoTransport`, backed by a local `makeRpcTransport` helper with a queue, fiber map, response envelopes, stream envelopes, cancel handling, and cause-to-host-error conversion.
- `packages/react/src/index.test.ts`, `packages/vue/src/index.test.ts`, and `packages/solid/src/index.test.ts` each duplicate the same fake host transport.
- Framework roots accept only `DesktopRendererRpcTransport`, so tests and browser examples are pushed through bridge protocol emulation even when the behavior under test is renderer endpoint construction or framework lifecycle.

## Target Shape

- Add an Effect-native renderer test-client constructor in core that builds `DesktopRendererRpcClientMap` values from a manifest and handler layers using `RpcTest.makeClient`.
- Allow React, Vue, Solid, and Next roots/options to receive renderer RPC handler layers in addition to real host `transport`, so the root still owns scoped runtime construction and disposal.
- Replace notes browser demo setup with `makeNotesDemoRpcLayers`, backed by the canonical `NotesRpcsLive`/`makeNotesRpcsLayer` handler layer.
- Replace adapter test `makeRpcTransport` helpers with `RpcTest`-backed renderer RPC layers.
- Keep bridge protocol fixtures only where the test is explicitly about protocol envelopes, origin/cancel/terminal state, or client/server protocol conversion.

## Architecture Debt Sweep

The duplicate fake transports are design debt because they partially reimplement Effect RPC semantics with local queues and fibers. They do not own durable desktop policy; they only exist because the framework adapters lacked a direct test-client path. The bridge protocol runtime and protocol tests remain legitimate adapters because they own desktop-specific envelope translation, origin checks, terminal-state tracking, and cancellation policy.

## Verification

- Focused tests:
  - `bun test apps/examples/notes-common/src/index.test.ts packages/react/src/index.test.ts packages/vue/src/index.test.ts packages/solid/src/index.test.ts`
  - `bun test packages/core/src/index.test.ts`
  - `bun test packages/bridge/src/protocol.rpc.test.ts packages/bridge/src/client.test.ts`
- Full validation before commit:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run lint:types`
  - `bun run check`
  - `bun test`
  - `bun run build`
  - `bun run desktop check --api`
  - `cargo fmt --check`
  - `cargo check --workspace`
  - `cargo test --workspace`
  - `cargo clippy --workspace --all-targets -- -D warnings`

## Out of Scope

- Replacing bridge protocol tests.
- Changing bridge wire format.
- Solving the broader scoped renderer runtime issue from #1281.
