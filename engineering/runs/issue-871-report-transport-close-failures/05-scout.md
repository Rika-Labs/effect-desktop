## Domain

Transport connection close semantics, specifically failures from underlying framed transports during shutdown.

## Evidence gathered

- `packages/core/src/runtime/transport.ts` — `TransportConnection.close` returns `Effect<void, never, never>`, making close failure unrepresentable at the interface.
- `packages/core/src/runtime/transport.ts` — `makeConnection(...).close()` catches any transport close exception as `undefined`, then catches all remaining errors as `Effect.void`.
- `packages/core/src/runtime/transport.ts` — send and receive already map underlying exceptions into typed `TransportError` values.
- `packages/core/src/runtime/transport.test.ts` — close coverage verifies receive fails after close, but no test covers close failure visibility.
- `AGENTS.md` — swallowed cleanup errors are forbidden; cleanup defects must be observable.

## First principles

- Primitive fact: closing a transport is effectful I/O and can fail.
- Invariant: callers must be able to distinguish clean close from failed cleanup.
- Constraint: send/receive error semantics are out of scope.
- Source of truth: `TransportConnection` owns the connection lifecycle boundary.

## Game board

- Runtime shutdown wants cleanup to be cheap, but operators need evidence when cleanup fails.
- Test authors need a substitutable transport that can throw on close.
- The bad local move is making close infallible to simplify callers, which pushes invisible cleanup defects into incidents.

## Handoff

Handoff: `/architect`
