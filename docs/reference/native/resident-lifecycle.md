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

| Platform | Status      | Reason |
| -------- | ----------- | ------ |
| macOS    | `supported` |        |
| Windows  | `supported` |        |
| Linux    | `supported` |        |

The host owns a process-local resident policy state. When enabled with `process: "keep-running"`, native close requests no longer exit the host process. When enabled with `windows: "close-to-background"`, native close requests hide the window instead of destroying it.

`launchAtLogin` is policy data only here; persistent login-item registration belongs to `Autostart`.

## Diagnostics

Enabled resident lifecycle policy is visible through `ResourceRegistry.list()` and `ResourceRegistry.observeLifecycle()`. Policy changes and terminal failures are observable through typed service failures and event streams.

## Files

- Service: [`packages/native/src/resident-lifecycle.ts`](../../../packages/native/src/resident-lifecycle.ts)
- Contract: [`packages/native/src/contracts/resident-lifecycle.ts`](../../../packages/native/src/contracts/resident-lifecycle.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/resident_lifecycle.rs`](../../../crates/host/src/methods/resident_lifecycle.rs)
