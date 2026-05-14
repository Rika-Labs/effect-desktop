# Layer-first framework contract

`engineering/SPEC.md` is normative. This document is the review checklist for the spec's Layer-first rule: user app code depends on Effect service requirements, and providers are swapped by replacing layers.

## Capability shape

Every new public effectful capability must expose one stable service requirement and provider layers with the same observable contract.

```ts
import { Context, Effect, Layer, Schema } from "effect"

export class WindowOptions extends Schema.Class<WindowOptions>("WindowOptions")({
  title: Schema.NonEmptyString
}) {}

export class WindowError extends Schema.TaggedError<WindowError>("WindowError")("WindowError", {
  reason: Schema.Literals(["PermissionDenied", "HostUnavailable"])
}) {}

export class Window extends Context.Service<Window, WindowService>()("Window", {
  make: Effect.gen(function* () {
    return {
      open: (options: WindowOptions): Effect.Effect<WindowHandle, WindowError, never> =>
        openWindowThroughHost(options)
    }
  })
}) {}

export const WindowLive = Layer.effect(Window)(makeLiveWindow())
export const WindowClientLive = Layer.effect(Window)(makeRpcWindow())
export const WindowTest = Layer.succeed(Window)(makeTestWindow())
```

Use `Context.Tag` only for ad-hoc dependency records that are not a public framework capability.

## Boundary rules

- Public effectful APIs return `Effect.Effect<A, E, R>`, not `Promise<A>`.
- Boundary input and output data uses `Schema.Class`.
- Expected failures use stable tagged errors.
- Live layer, Client layer, and Test layer satisfy the same service requirement.
- A capability that crosses renderer, runtime, or host processes exposes a Client layer from the typed contract.
- App code branches on typed provider facts, not on concrete provider names.
- `ManagedRuntime` and `Effect.run*` stay at composition edges: CLI entrypoints, renderer hooks, Vite callbacks, tests, and host/bootstrap glue.
- Concrete globals such as Bun, Node, filesystem, host, clock, random, environment, WebView, or network services stay inside provider implementations.

## Review checklist

For every new public effectful capability, reviewers should be able to answer yes to each item:

- Does the API have one service requirement with a stable tag or class name?
- Are all public effectful operations typed as `Effect.Effect<A, E, R>` with the environment preserved?
- Are request, response, event, and persisted boundary shapes schema-coded with `Schema.Class`?
- Are expected failures typed tagged errors rather than throws, booleans, or swallowed errors?
- Does the capability expose a Live layer?
- Does it expose a deterministic Test layer that requires no native host, OS prompt, real process, real filesystem mutation, or network service?
- If it crosses a process or RPC boundary, does it expose a Client layer generated from the same typed contract?
- Can the same user-level program run under Live, Client, and Test layers without changing code?
- Are resources, streams, workers, processes, sockets, subscriptions, and handles owned by `Scope`, scoped layers, `Stream`, `Resource`, `RcMap`, `FiberSet`, or an equivalent Effect primitive?
- Are provider choices selected by data and supplied as layers?
- Are optional providers behind explicit subpaths, package boundaries, or lazy layer selection?
- Is any `Promise`, concrete global, or `Effect.run*` use confined to an integration edge?

## Generated RPC surfaces

`Desktop.Rpc.surface(name, group, options)` is the Layer-first packaging point for a renderer-callable `RpcGroup`.

The `RpcGroup` remains the source of truth for endpoint tags, request and response schemas, endpoint kind metadata, capability metadata, and support metadata. The surface adds the artifacts a capability needs around that one contract:

- `serverLayer` binds the handler layer into a desktop app.
- `clientLayer` creates the service client from an Effect RPC protocol.
- `testClientLayer` creates the same service client against the handler layer for deterministic tests.
- `schemaDocs` exposes the documented endpoint shape without introducing another DSL.
- `contractLaws` exposes executable checks for bridge-compatible tags, unique renderer endpoint names, and schema-backed endpoints.

Use the direct surface shape when the public service is the generated `DesktopRpcClient<Rpcs>`. Use the mapped shape only when the capability already owns a durable service API, such as `ScreenClient`, and the mapper hides generated RPC details behind that service.

Use `Desktop.Rpc.supportedGroup(group)` when a capability intentionally publishes a larger descriptor group than the host can call today. Unsupported RPCs remain in `schemaDocs` and renderer descriptors, but generated client services are built from the filtered supported group. That prevents unsupported methods from looking like ordinary callable service methods.

## Current proof

`packages/test/src/index.test.ts` contains the `native capability programs run unchanged through Live, Client, and Test layers` test. It defines user-level `Effect` programs for `Screen`, `Clipboard`, and `Dialog` and runs each through:

- the capability `*Live` layer with an explicit deterministic `*Client` layer;
- the capability `*Live` layer with `make*BridgeClientLayer(...)`;
- the matching deterministic `*Test(...)` layer from `@effect-desktop/test`.

That is the minimum substitution claim this contract requires: provider replacement changes layers, not user code.

`packages/native/src/screen.ts`, `packages/native/src/clipboard.ts`, and `packages/native/src/dialog.ts` are the current generated native vertical slices. Their `*Rpcs` values are canonical Effect `RpcGroup`s; their `*Surface` values derive server, client, test-client, schema-doc, and law artifacts; their `make*BridgeClientLayer(...)` functions adapt the existing bridge exchange into the generated RPC protocol instead of widening the public service contract.

`packages/native/src/window.ts` proves the callable-client rule. `WindowRpcs` exposes only host-backed methods, currently `Window.create` and `Window.close`; planned Window methods stay out of the RPC group until the host path exists.
