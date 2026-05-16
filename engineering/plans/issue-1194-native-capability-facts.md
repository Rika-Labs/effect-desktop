# Issue #1194: Expose Native Capability Facts as Data

## Current state

The contract side is already partially aligned with the issue:

- `RpcSupport` is an Effect RPC annotation exported through `@effect-desktop/bridge`.
- `DesktopRpc.supportedGroup(...)` filters unsupported RPCs from static generated clients.
- `WindowRpcs` annotates unsupported planned operations, while `WindowSupportedRpcs` exposes
  only implemented methods.
- `describeRpcs(...)` and `DesktopRpc.surface(...)` already surface support metadata in docs.

The missing runtime piece is a native service that turns those annotations into capability facts
that app code can inspect before calling.

## Architecture

Add `NativeCapabilities` in `packages/native` as a service backed by existing Effect RPC
annotations, not a new support DSL.

The service should expose:

- `manifest`: frozen facts derived from native `RpcGroup.requests`;
- `support(tag)`: returns the `RpcSupport` metadata for a method tag such as `Window.show`;
- `require(tag)`: succeeds for supported methods and fails with `UnsupportedCapability` for
  unsupported methods;
- typed lookup failure for unknown tags.

The default `NativeCapabilitiesLive` layer should be built from the native RPC groups that the
package already exports. Tests can also build smaller layers from arbitrary groups to keep the
service local-substitutable.

Do not claim runtime-detected support is statically reflected in TypeScript. Static filtering stays
with `DesktopRpc.supportedGroup`, which already covers that side of the issue.

## Files

- `packages/native/src/capabilities.ts`
  - Add the `NativeCapabilities` service, fact types, lookup/manifest errors, default live layer,
    and a pure/effectful manifest builder from RPC groups.
- `packages/native/src/index.ts`
  - Export the new service and helpers from the public native root.
- `packages/native/src/index.test.ts` or `packages/native/src/capabilities.test.ts`
  - Prove `Window.show` is inspectable as unsupported data.
  - Prove `Window.create` is supported.
  - Prove `require("Window.show")` fails only when explicitly required and carries the same
    unsupported reason as the annotation.
  - Prove unknown tags fail with a typed native capability lookup error.
  - Prove duplicate manifest tags fail rather than silently overwriting support data.
- `api/snapshots/@effect-desktop__native.snapshot.json`
  - Update after exporting the new public service.
- `engineering/roadmap/layer-first-issue-order.md`
  - Mark #1194 implemented.
- `engineering/learnings/2026-05-12-native-capability-facts.md`
  - Capture the annotation-to-runtime-fact rule after verification.

## Tests

Focused:

- `bun test packages/native/src/capabilities.test.ts packages/native/src/index.test.ts`
- `bun run --filter @effect-desktop/native typecheck`

Broad:

- `bun run check`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:types`
- `bun run format:check`
- `bun run desktop check --api --write`
- `bun run desktop check --api`
- `bun test`
- `bun run build`
- Rust workspace checks if broad validation reaches that point.

## Thin wrappers / follow-ups

Remove now:

- Any new hand-authored native support table for methods that already have `RpcSupport`
  annotations. Runtime capability facts must be derived from the `RpcGroup` request metadata.

Keep as tracked follow-up:

- #1286 removes remaining `as unknown as` adapters around generated Effect RPC clients.
- #1284 adds guardrails against non-policy wrappers over Effect.
- Existing `isSupported` methods on platform-specific services are runtime platform probes, not
  replacements for this descriptor manifest. They can later be reconciled with host-profile support
  if a specific ticket needs dynamic platform detection.
