# 2026-05-18: App Metadata Boundary

Issue: <https://github.com/Rika-Labs/effect-desktop/issues/1341>

## What Changed

Added a dedicated `AppMetadata` native surface for app identity, paths, launch
context, and environment-shape contracts:

- `AppMetadata.getInfo`
- `AppMetadata.getPaths`
- `AppMetadata.getLaunchContext`
- `AppMetadata.Event`

The TypeScript service, bridge client, host protocol structs, and Rust host
routes now agree on the wire shape. The host still fails closed with typed
`Unsupported` because package/config/runtime metadata sources are not
implemented.

## Why

Metadata and launch context are read-only host facts. They should not be spread
across renderer code or folded into generic lifecycle methods.

The trade-off is a public boundary before platform support. That is acceptable
only because the boundary is honest: capability metadata and docs say
unsupported, and Rust routes return typed `Unsupported` after rejecting malformed
payloads.

## Verification

- TypeScript tests cover RPC declaration, service delegation, bridge envelopes,
  event decoding, strict host-output validation, permission denial, unsupported
  errors, and host transport errors.
- Rust host protocol tests cover AppMetadata payload encoding, launch reason
  decoding, event phase decoding, and excess-field rejection.
- Rust host router tests cover typed unsupported responses and present-payload
  rejection before unsupported.

## Architecture-Debt Sweep

No wrapper was removed in this ticket.

Debt found: `App.getInfo` and `App.getCommandLine` overlap with the new
`AppMetadata` surface. Follow-up issue #1407 tracks removing or delegating the
legacy App metadata helpers after `AppMetadata` has real host-backed sources.
The intended direction is for `AppMetadata` to own metadata and launch-context
reads, with App retaining lifecycle behavior.

Known remaining debt:

- Real host-backed package/config/runtime metadata sources must replace the
  current typed unsupported routes.
- `App.getInfo` and `App.getCommandLine` should be removed or reduced to
  explicit delegation once `AppMetadata` has real host adapters.
- Environment values must remain out of the public launch-context contract
  unless a later issue adds explicit secret-aware access policy.
