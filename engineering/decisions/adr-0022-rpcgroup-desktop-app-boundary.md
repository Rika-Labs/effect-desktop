# ADR-0022: Make RpcGroup the desktop app boundary

## Status

Accepted, with the registration shape amended in PR #1306.

The boundary decision (RpcGroup as the renderer-callable contract) is unchanged.
The assembly mechanism evolved: pairs of `(group, layer)` registered through
`Desktop.Rpcs.layer(...)` were replaced with `Desktop.rpc(group, handlers)`
returning a `Layer<DesktopRpcRegistry, ...>`, composed via `Layer.mergeAll(...)`.
See "Amendments" below.

## Context

Effect Desktop had competing concepts for renderer-callable APIs:

- raw Effect `RpcGroup` values from `effect/unstable/rpc`;
- framework-level provider and hook APIs that could drift from either contract model.

That split made common app code harder than it should be. A developer could define an Effect service, a desktop API, and a React hook surface without one value proving that the renderer contract, runtime implementation, permissions, support metadata, and UI adapter all describe the same boundary.

The framework also needs to serve React, Vue, Solid, Next, and Astro without pretending those frameworks model state the same way. React has hooks. Vue has composables and refs. Solid has resources, accessors, signals, and owner cleanup. Astro has hydrated islands, not `.astro` hooks. Copying the React shape into every adapter makes examples look familiar but creates a shallow abstraction that leaks lifecycle semantics.

Effect v4 already gives the right primitive: `RpcGroup` is a pure contract value, `RpcGroup.toLayer` binds handlers through an Effect `Layer`, and `RpcClient` / `RpcServer` own typed request execution. The desktop framework should add desktop-specific metadata and assembly around that primitive, not invent another contract language.

## Decision

`RpcGroup` is the boundary for every renderer-callable desktop API.

- New app APIs define one or more `Rpc.make(...)` values and collect them with `RpcGroup.make(...)`.
- Runtime implementations use `RpcGroup.toLayer({ ...handlers })`.
- Desktop app assembly pairs the contract and implementation with `Desktop.rpc(group, handlers)` (amended; see below).
- `Desktop.make({ windows })` owns declared startup windows and app shape.
- Apps compose ordinary Effect layers with `Layer` operators and attach desktop RPC layers through the app descriptor `rpcs` field.
- Framework adapters derive their public client shape from the assembled desktop app and the provided `RpcGroup`.

Endpoint metadata is carried on the RPC value through Effect annotations:

- `RpcEndpoint.query(rpc)` marks a non-stream endpoint as query-like.
- `RpcEndpoint.mutation(rpc)` marks a non-stream endpoint as mutation-like.
- `RpcCapability(capability)` carries the full scoped capability metadata required
  by the permission registry, not only the capability kind.
- `RpcSupport.supported(rpc)` and `RpcSupport.unsupported(reason)(rpc)` expose implemented and unsupported methods to descriptors.

Framework adapters are intentionally framework-native:

- React exposes hooks from `ReactDesktop.from(Desktop.manifest(App)).useDesktop(group)`.
- Vue exposes composables returning refs from `VueDesktop.from(Desktop.manifest(App)).useDesktop(group)`.
- Solid exposes resources, accessors, mutation state, and owner-scoped cleanup from `SolidDesktop.from(Desktop.manifest(App)).useDesktop(group)`.
- Next is a client-component wrapper around the React adapter.
- Astro records island metadata and validates hydration directives; desktop access lives in hydrated React, Vue, or Solid islands.

Framework adapters derive runtime clients from the desktop manifest and the
host-installed renderer transport. Raw client maps are not a normal public API
because manual maps let renderer code drift from the assembled app boundary.

Startup windows are host-owned. Renderer components must not open the initial window as a side effect. The runtime exposes declared window metadata after protocol readiness, and the host opens those windows from the `Desktop.make({ windows })` declaration.

## Alternatives considered

**Keep a custom desktop API spec as the main app API**: it preserves early examples, but keeps a custom contract language beside Effect's own RPC model. Every framework adapter would have to understand that spec directly or depend on a generated intermediate representation. Rejected.

**Expose `DesktopProvider` as the normal app assembly path**: it is easy for React users but wrong as the framework boundary. Providers are renderer-local wiring, not the source of app capabilities. They also do not translate cleanly to Vue, Solid, Next, or Astro. Rejected.

**Require separate `apis` and `layers` arrays**: this makes drift easy. A contract can be declared without its implementation, or an implementation can be provided without the adapter seeing the contract. Rejected.

**Use string lookups such as `useDesktop(\"terminal\")`**: strings are easy to demo and poor under refactor. They sever the type link between the imported contract and the adapter surface. Rejected.

**Give Astro a hook API**: Astro files do not have a hook lifecycle. Desktop access must live in hydrated framework islands where state and cleanup semantics are real. Rejected.

## Consequences

**Positive**

- One imported `RpcGroup` value identifies the renderer contract everywhere: runtime layer, app assembly, framework adapter, docs, tests, and examples.
- App authors can use ordinary Effect v4 composition instead of framework-specific provider plumbing.
- Adapter behavior stays honest to each frontend framework's state model.
- Unsupported native methods become observable metadata rather than looking complete until invoked.
- Missing providers, missing clients, and missing `RpcGroup`s fail with explicit typed errors.

**Negative**

- The framework now depends more directly on `effect/unstable/rpc` API stability.
- Framework adapters need separate implementations rather than one shared React-shaped facade.

**Neutral**

- Existing low-level React provider hooks remain available, but new docs and templates use `ReactDesktop.from(Desktop.manifest(App))`.
- Native host support remains partial. This ADR only makes support visible; it does not implement missing host methods.

## Dependency note

`repos/effect-smol` is a pinned upstream Effect v4 smol reference checkout for grounding `RpcGroup`, `RpcClient`, and `RpcServer` API behavior while this boundary uses `effect/unstable/rpc`. It is not runtime vendoring: packages must import Effect from the workspace dependency in `package.json`, not from `repos/effect-smol`. Update the subtree when the Effect beta changes RPC semantics, then verify the framework bridge and adapter tests against the pinned package version.

## Migration notes

New apps should define APIs as:

```ts
import { Effect, Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { Desktop } from "@effect-desktop/core"

class Note extends Schema.Class<Note>("Note")({
  id: Schema.String,
  title: Schema.String
}) {}

export const ListNotes = Rpc.make("notes.list", {
  success: Schema.Array(Note),
  error: Schema.Never
}).pipe(Desktop.RpcEndpoint.query)

export const CreateNote = Rpc.make("notes.create", {
  payload: Schema.Struct({ title: Schema.String }),
  success: Note,
  error: Schema.Never
}).pipe(Desktop.RpcEndpoint.mutation)

export const NotesRpcs = RpcGroup.make(ListNotes, CreateNote)

export const NotesLive = NotesRpcs.toLayer({
  "notes.list": () => Effect.succeed([]),
  "notes.create": ({ title }) => Effect.succeed(new Note({ id: "note-1", title }))
})

export const App = Desktop.make({
  windows: {
    main: { title: "Notes", width: 960, height: 640, renderer: "/" }
  },
  rpcs: Desktop.rpc(NotesRpcs, NotesLive) // compose multiple via Layer.mergeAll(...)
})
```

Renderer code should import the framework adapter, not raw bridge clients:

```tsx
const Manifest = Desktop.manifest(App)
const NotesReact = ReactDesktop.from(Manifest)

function NotesView() {
  const notes = NotesReact.useDesktop(NotesRpcs)
  const list = notes.list.useQuery()
  const create = notes.create.useMutation()
  // render framework-local state
}
```

## Validation

- A new `RpcGroup` app API can be implemented with `toLayer`, provided with `Desktop.rpc(group, handlers)`, and consumed from React, Vue, and Solid adapters.

## Amendments

### PR #1306 — Registration shape (registry-based composed Layer)

The original ADR paired `(group, layer)` through `Desktop.Rpcs.layer(group, layer)`,
which produced a `DesktopRpcLayer<Rpcs, E, R>` value carried in `Desktop.make({ rpcs: [...] })`.
PR #1306 replaced that pair with a single composed Layer:

- `Desktop.rpc(group, handlers)` returns `Layer<DesktopRpcRegistry, ...>` and self-registers
  the `(group, handlers)` pair when its body runs.
- Multiple registrations compose via `Layer.mergeAll(...)`.
- `Desktop.make({ rpcs })` now accepts a single `Layer<DesktopRpcRegistry, ...>`
  rather than `ReadonlyArray<DesktopRpcLayer>`.

Removed: `AnyDesktopRpcLayer`, `DesktopRpcLayer`, `Desktop.Rpcs.layer`, the entire
`packages/core/src/runtime/rpc-group-metadata.ts` file, plus `servedRpcGroup` and
the `Symbol("@effect-desktop/core/servedRpcGroup")` metadata channel.

The boundary decision (RpcGroup as the renderer-callable contract) is unchanged —
the same `RpcGroup`, the same `RpcGroup.toLayer({ ...handlers })`, the same renderer
adapter shape. Only the desktop-app assembly mechanism changed. The new shape mirrors
the cluster `Entity` + `Sharding` self-registration pattern in `repos/effect-smol`.

- `Desktop.describeRpcs(app, group)` rejects unprovided groups with `MissingDesktopRpcsError`.
- React, Vue, and Solid adapters reject absent provider context and missing clients with typed framework errors.
- Startup window declarations are opened by the runtime/host path after protocol readiness.
- Native `WindowRpcs` reports implemented and unsupported methods through `RpcSupport` metadata.
