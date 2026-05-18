# 2026-05-18: Association Boundary

Issue: <https://github.com/Rika-Labs/effect-desktop/issues/1338>

## What Changed

Added a dedicated `Association` native surface for OS-level protocol and file
association contracts:

- `Association.isDefaultProtocolClient`
- `Association.setDefaultProtocolClient`
- `Association.getFileAssociations`
- `Association.Event`

The TypeScript service, bridge client, host protocol structs, and Rust host
routes now agree on the wire shape. The host still fails closed with typed
`Unsupported` because platform association adapters are not implemented.

## Why

`Protocol` already means in-app custom protocol serving for WebViews. OS
default handlers are a different boundary: they touch installer state, platform
registries, user consent, and observable default-client status. Keeping them in
`Protocol` would make one surface own two lifecycles.

The trade-off is an extra public native surface now for a smaller contract
later. That is acceptable because the new surface owns durable desktop policy,
not a wrapper over Effect.

## Verification

- TypeScript tests cover RPC declaration, service delegation, bridge envelopes,
  event decoding, strict scheme and extension validation, unsupported errors,
  and host transport errors.
- Rust host protocol tests cover Association payload encoding and excess-field
  rejection.
- Rust host router tests cover typed unsupported responses and malformed payload
  rejection before unsupported.

## Architecture-Debt Sweep

No wrapper was removed in this ticket.

`Protocol` is not debt in the touched area because it owns implemented WebView
custom protocol serving policy. `Association` is also not a thin wrapper over
Effect primitives; it is a native/web boundary for OS-level desktop semantics
that Effect does not model.

Debt removed after this note:

- The duplicate unsupported `App.registerProtocol` surface and Rust App route
  were removed; `Association` owns OS default protocol registration and
  `Protocol` owns WebView custom protocol serving.

Known remaining debt:

- Real platform adapters must eventually replace the current typed unsupported
  routes.
- Association state and events must become observable from host-owned platform
  sources instead of bridge-only contract tests.
