# Window Visibility Events

Issue: #1342

## What Changed

`Window.show` and `Window.hide` now publish non-terminal `Window.Event`
registry phases: `shown` and `hidden`.

The event contract is shared across the bridge Schema, native Schema, and Rust
host protocol. Renderer-side reconciliation treats `shown` and `hidden` like
`focused`: it attaches a live `WindowHandle` when the window is still
registered and does not close the resource scope.

## Verification

- `WindowRegistryEventPayload` serializes `shown` and `hidden` as non-terminal
  host-protocol events.
- The Rust host runtime sender encodes the visibility event payload shape.
- The TypeScript window runtime emits ordered `opened`, `shown`, `hidden`,
  `focused`, and `closed` events through the existing app event router path.

## Architecture-Debt Sweep

No wrapper was removed. The changed code extends the existing
Schema/RPC/Layer/native boundary and Rust event-loop adapter; it does not add a
parallel abstraction over Effect.

Remaining #1342 debt: ORIKA still does not expose a portable `blur`
command or a separate OS close-request veto/confirm lifecycle distinct from
`destroy`.
