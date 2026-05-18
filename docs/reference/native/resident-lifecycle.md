# Resident Lifecycle

Resident lifecycle separates app process lifetime, window lifetime, and background availability. It is product-neutral policy data: whether the process quits with the last window, whether windows close into background availability, which background presence is expected, and whether launch-at-login should be requested.

The public service is Layer-first and test-substitutable. It validates Schema contracts before native transport, checks `native.invoke` permissions before host side effects, registers the enabled policy with `ResourceRegistry` before the host mutation becomes visible, and releases the policy on explicit disable or resource-scope cleanup through the registry lifecycle.

## Surface

- `ResidentLifecycle.enable(request)` applies a resident lifecycle policy and returns the observed state.
- `ResidentLifecycle.disable(request)` disables resident policy and releases the resource.
- `ResidentLifecycle.getState()` returns the current host state.
- `ResidentLifecycle.events()` streams lifecycle state changes.
- `ResidentLifecycle.isSupported()` reports platform support.

## Platform Support

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

Unsupported native methods return typed `Unsupported` failures. They do not silently no-op. Real OS resident behavior is not implemented yet.

## Diagnostics

Enabled resident lifecycle policy is visible through `ResourceRegistry.list()` and `ResourceRegistry.observeLifecycle()`. Policy changes and terminal failures are observable through typed service failures and event streams.

## Files

- Service: [`packages/native/src/resident-lifecycle.ts`](../../../packages/native/src/resident-lifecycle.ts)
- Contract: [`packages/native/src/contracts/resident-lifecycle.ts`](../../../packages/native/src/contracts/resident-lifecycle.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/resident_lifecycle.rs`](../../../crates/host/src/methods/resident_lifecycle.rs)
