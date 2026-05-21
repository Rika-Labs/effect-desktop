# Transient Window Role

Transient window roles describe product-neutral floating windows such as launchers, palettes, popovers, utility panels, and companion windows. The role contract is data: focus, dismissal, z-order, placement, and restoration policy are explicit fields rather than app-specific behavior.

The public service is Layer-first and test-substitutable. It checks `native.invoke` permissions before host side effects and exposes platform support through the typed `isSupported` query.

## Surface

The only callable RPC on this surface is the support query:

- `TransientWindowRole.isSupported()` reports platform support.
- `TransientWindowRole.events()` exposes the role lifecycle stream (`opened`, `repositioned`, `dismissed`, `failed`).

## Capability facts (non-callable)

`open`, `reposition`, and `dismiss` are not callable RPCs. They are advertised in the native capability manifest as capability facts with `support.status: "unsupported"` and reason `host-adapter-unimplemented`, but no host adapter can be invoked. They describe the intended role-mutation contract; they cannot be called until a native role adapter exists.

`open` cannot be implemented as a generic `Window.create` wrapper. The request carries actor, role id, and window role policy; it does not carry renderable content, a declared window binding, or a host role registry entry. A correct adapter must map `roleId` to host-owned content, apply placement/focus/z-order/restoration policy, allocate a generation-stamped transient-role handle, and publish `opened` or `failed`.

`reposition` cannot be supported independently from `open`. A correct implementation must validate a transient-role handle against the role registry, translate role placements such as owner-relative and display-relative into host window bounds, update the owned window, and publish `repositioned` or `failed`. A standalone `Window.setBounds` call would skip role ownership and placement policy.

`dismiss` cannot be supported independently from `open`. A correct implementation must dismiss a host-owned transient role by generation-checked handle, dispose it exactly once, restore focus according to the role policy, and publish a lifecycle event. Without a role registry created by `open`, a standalone `dismiss` would either be unreachable or would risk treating arbitrary window IDs as transient-role handles.

| Capability fact | Intended role                                                 |
| --------------- | ------------------------------------------------------------- |
| `open`          | Show a transient role and return a generation-stamped handle. |
| `reposition`    | Update placement for an open role.                            |
| `dismiss`       | Dismiss an open role and dispose it exactly once.             |

## Platform Support

| Platform | Status        | Reason                       |
| -------- | ------------- | ---------------------------- |
| macOS    | `unsupported` | `host-adapter-unimplemented` |
| Windows  | `unsupported` | `host-adapter-unimplemented` |
| Linux    | `unsupported` | `host-adapter-unimplemented` |

The bridge-backed `TransientWindowRole.Event` stream fails as typed `Unsupported` before opening
a host subscription until the native role adapter can publish real role lifecycle events.

## Diagnostics

Recent failures are observable through the typed service failure channel and the event stream for substitutable clients.

## Files

- Service: [`packages/native/src/transient-window-role.ts`](../../../packages/native/src/transient-window-role.ts)
- Contract: [`packages/native/src/contracts/transient-window-role.ts`](../../../packages/native/src/contracts/transient-window-role.ts)
- Host protocol: [`crates/host-protocol/src/lib.rs`](../../../crates/host-protocol/src/lib.rs)
- Host router: [`crates/host/src/methods/transient_window_role.rs`](../../../crates/host/src/methods/transient_window_role.rs)
