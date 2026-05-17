# Activation Registry

The activation registry is a product-neutral broker for native activation surfaces such as shortcuts, tray items, dock actions, protocol links, file-open events, and notifications. A registered surface maps an activation source to a command id; routing always goes through `CommandRegistry` with a typed permission context instead of a direct callback shortcut.

The public service is Layer-first and test-substitutable. It validates Schema contracts before native transport, checks `native.invoke` permissions before host side effects, registers generation-stamped handles with `ResourceRegistry`, and publishes typed activation events for registration, routing, unregister, and failure paths.

## Surface

- `ActivationRegistry.registerSurface(request)` returns a `ResourceHandle<"activation-surface", "registered">`.
- `ActivationRegistry.unregisterSurface(request)` unregisters the surface and disposes the resource.
- `ActivationRegistry.routeActivation(request)` invokes the registered command through `CommandRegistry`.
- `ActivationRegistry.listSurfaces()` returns the local registered surface table.
- `ActivationRegistry.events()` streams activation lifecycle events.
- `ActivationRegistry.isSupported()` reports platform support.

## Platform Support

| Platform | Status | Reason |
|---|---|---|
| macOS | `unsupported` | `host-adapter-unimplemented` |
| Windows | `unsupported` | `host-adapter-unimplemented` |
| Linux | `unsupported` | `host-adapter-unimplemented` |

Unsupported native methods return typed `Unsupported` failures. They do not silently no-op.

## Diagnostics

Active activation resources are visible through `ResourceRegistry.list()` and `ResourceRegistry.observeLifecycle()`. Every activation event includes the source, payload, actor, trace id, and permission context so command routing can be audited without depending on UI-specific callbacks.

## Files

- Service: [`packages/native/src/activation-registry.ts`](../../../packages/native/src/activation-registry.ts)
- Contract: [`packages/native/src/contracts/activation-registry.ts`](../../../packages/native/src/contracts/activation-registry.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/activation_registry.rs`](../../../crates/host/src/methods/activation_registry.rs)
