# Transient Window Role

Transient window roles describe product-neutral floating windows such as launchers, palettes, popovers, utility panels, and companion windows. The role contract is data: focus, dismissal, z-order, placement, and restoration policy are explicit fields rather than app-specific behavior.

The public service is Layer-first and test-substitutable. It validates Schema contracts before native transport, checks `native.invoke` permissions before host side effects, registers generation-stamped handles with `ResourceRegistry` before asking the host to show a role, and releases the resource on host failure, explicit dismissal, scope close, cancellation, renderer disconnect, or runtime restart through the registry lifecycle.

## Surface

- `TransientWindowRole.open(request)` returns a `ResourceHandle<"transient-window-role", "open">`.
- `TransientWindowRole.reposition(request)` updates placement for a fresh handle.
- `TransientWindowRole.dismiss(request)` dismisses a fresh handle and disposes it exactly once.
- `TransientWindowRole.events()` streams `opened`, `repositioned`, `dismissed`, and `failed` events.
- `TransientWindowRole.isSupported()` reports platform support.

## Platform Support

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

Unsupported mutation methods return typed `Unsupported` failures. They do not silently no-op.
The bridge-backed `TransientWindowRole.Event` stream also fails as typed `Unsupported` before opening
a host subscription until the native role adapter can publish real role lifecycle events.

## Diagnostics

Active role resources are visible through `ResourceRegistry.list()` and `ResourceRegistry.observeLifecycle()`. Recent failures are observable through the typed service failure channel and the event stream for substitutable clients.

## Files

- Service: [`packages/native/src/transient-window-role.ts`](../../../packages/native/src/transient-window-role.ts)
- Contract: [`packages/native/src/contracts/transient-window-role.ts`](../../../packages/native/src/contracts/transient-window-role.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/transient_window_role.rs`](../../../crates/host/src/methods/transient_window_role.rs)
