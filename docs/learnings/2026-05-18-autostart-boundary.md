# 2026-05-18: Autostart Boundary

Issue: <https://github.com/Rika-Labs/effect-desktop/issues/1340>

## What Changed

Added a dedicated `Autostart` native surface for OS-level login-item and
autostart contracts:

- `Autostart.isEnabled`
- `Autostart.enable`
- `Autostart.disable`
- `Autostart.Event`

The TypeScript service, bridge client, host protocol structs, and Rust host
routes now agree on the wire shape. The host still fails closed with typed
`Unsupported` because platform autostart adapters are not implemented.

## Why

Autostart is platform persistence, not generic App lifecycle. It needs a narrow
surface that can report the mechanism being used: macOS login item, Windows Run
key, Linux XDG autostart, or unsupported.

The trade-off is keeping the existing broad `App.setOpenAtLogin` unsupported
while adding a clearer boundary. That avoids pretending the App surface owns
durable platform policy it does not implement.

## Verification

- TypeScript tests cover RPC declaration, service delegation, bridge envelopes,
  event decoding, strict launch-argument validation, permission denial,
  unsupported errors, and host transport errors.
- Rust host protocol tests cover Autostart payload encoding and excess-field
  rejection.
- Rust host router tests cover typed unsupported responses and malformed
  payload rejection before unsupported.

## Architecture-Debt Sweep

No wrapper was removed in this ticket.

Debt found: `App.setOpenAtLogin` remains a broad unsupported method that
overlaps with `Autostart`. This is tracked by still-open issue #1340 and must be
resolved before that issue is closed. The intended direction is for `Autostart`
to own login-item policy and for App-level login-item helpers to be removed or
reduced to explicit delegation once platform adapters exist.

Known remaining debt:

- Real platform adapters must replace the current typed unsupported routes.
- Permission/audit behavior for real persistence writes must be preserved when
  the adapter moves from unsupported to supported.
- The overlap with `App.setOpenAtLogin` should be resolved when the host-backed
  Autostart service is implemented.
