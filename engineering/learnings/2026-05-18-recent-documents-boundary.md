# 2026-05-18: Recent Documents Boundary

Issue: <https://github.com/Rika-Labs/effect-desktop/issues/1339>

## What Changed

Added a dedicated `RecentDocuments` native surface for OS-level recent-document
contracts:

- `RecentDocuments.add`
- `RecentDocuments.clear`
- `RecentDocuments.list`
- `RecentDocuments.Event`

The TypeScript service, bridge client, host protocol structs, and Rust host
routes now agree on the wire shape. The host still fails closed with typed
`Unsupported` because platform recent-document adapters are not implemented.

## Why

Recent documents are platform-owned document workflow state. They should not be
modeled as shell helpers or app-specific filesystem writes.

The trade-off is a public boundary before platform support. That is acceptable
only because the boundary is honest: capability metadata and docs say
unsupported, and the Rust host routes return typed `Unsupported` after decoding
and validation.

## Verification

- TypeScript tests cover RPC declaration, service delegation, bridge envelopes,
  event decoding, strict path validation, permission denial, unsupported
  errors, and host transport errors.
- Rust host protocol tests cover RecentDocuments payload encoding and
  excess-field rejection.
- Rust host router tests cover typed unsupported responses and malformed
  payload rejection before unsupported.

## Architecture-Debt Sweep

No wrapper was removed in this ticket.

No existing recent-document abstraction was found in the touched area. The new
surface is not a thin wrapper over Effect primitives; it is a native/web
boundary for OS-level desktop semantics that Effect does not model.

Known remaining debt:

- Real platform adapters must replace the current typed unsupported routes.
- Recent document state and events must become observable from host-owned
  platform sources instead of bridge-only contract tests.
- Permission/audit behavior for real platform writes must be preserved when the
  adapter moves from unsupported to supported.
