# Activation Registry

The activation registry is a product-neutral broker for native activation surfaces such as shortcuts, tray items, dock actions, protocol links, file-open events, and notifications. A registered surface maps an activation source to a command id; routing always goes through `CommandRegistry` with a typed permission context instead of a direct callback shortcut.

The public service is Layer-first and test-substitutable. It validates Schema contracts before native transport, checks `native.invoke` permissions before host side effects, registers generation-stamped handles with `ResourceRegistry`, and publishes typed activation events for registration, routing, unregister, and failure paths.

## Surface

- `ActivationRegistry.registerSurface(request)` returns a `ResourceHandle<"activation-surface", "registered">`.
- `ActivationRegistry.unregisterSurface(request)` unregisters the surface and disposes the resource.
- `ActivationRegistry.routeActivation(request)` invokes the registered command through `CommandRegistry`.
- `ActivationRegistry.listSurfaces()` returns the host registered surface table.
- `ActivationRegistry.events()` streams activation lifecycle events.
- `ActivationRegistry.isSupported()` reports platform support.

`events()` is exposed as the canonical `ActivationRegistry.events.Event` RPC stream. The bridge client keeps translating that contract to the existing host event channel `ActivationRegistry.Event`, so direct clients consume the Effect RPC stream while the native/web boundary preserves the current wire method.

## Platform Support

| Platform | Status      | Reason                           |
| -------- | ----------- | -------------------------------- |
| macOS    | `supported` | Host surface table is available. |
| Windows  | `supported` | Host surface table is available. |
| Linux    | `supported` | Host surface table is available. |

The Rust host adapter validates and stores activation surface registrations,
returns generation-stamped activation surface handles, lists registered
surfaces, and removes registered surfaces on unregister. Source-specific native
activation producers, such as global shortcuts, tray items, protocol links,
file-open events, and notification actions, remain owned by their respective
surfaces. Public `routeActivation` still routes through the Layer-first
`ActivationRegistry` service and `CommandRegistry`, preserving source, payload,
actor, trace id, and permission context.

## Diagnostics

Active activation resources are visible through `ResourceRegistry.list()` and `ResourceRegistry.observeLifecycle()`. Every activation event includes the source, payload, actor, trace id, and permission context so command routing can be audited without depending on UI-specific callbacks.

## Architecture-debt sweep

The legacy `ActivationRegistryRpcEvents` side object has been removed. Activation events now live in the same `RpcGroup` contract as request/response methods. The zero-policy `ActivationRegistryLive` alias was also removed; callers should use `ActivationRegistry.layer`.

`ActivationRegistryServiceApi` remains public because it includes service-only `routeActivation` behavior and owns permission-context validation, resource cleanup, command routing, audit, and event publication semantics that are not present on the native client port.

## Files

- Service: [`packages/native/src/activation-registry.ts`](../../../packages/native/src/activation-registry.ts)
- Contract: [`packages/native/src/contracts/activation-registry.ts`](../../../packages/native/src/contracts/activation-registry.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/activation_registry.rs`](../../../crates/host/src/methods/activation_registry.rs)
