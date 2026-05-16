# Remove Desktop App Builder DSL

Issue: #1278

## What changed

`Desktop.make(...)` now returns a frozen metadata descriptor instead of a custom app definition with
its own `pipe`, `layers`, `Desktop.provide`, and `Desktop.toLayer` composition model. Runtime
lowering is the normal `Desktop.layer(App)` / `Desktop.runtime(App)` Layer surface.

RPC handlers moved into `Desktop.make({ rpcs: [...] })` as descriptor metadata, while their
implementations remain ordinary Effect RPC layers. `Desktop.Rpcs.layer(...)` stayed because it owns
desktop-specific pairing: the `RpcGroup` must remain available for manifests, duplicate detection,
permission validation, renderer test clients, and runtime server wiring.

## What mattered

The useful invariant was not simply "delete the helper." The descriptor still had to preserve the
Effect requirements of attached RPC handler layers. An erased descriptor would have removed the
custom DSL at the value level while quietly hiding missing services and typed errors from the type
system.

Review forced `AnyDesktopRpcLayer`, `DesktopConfig`, `DesktopMakeConfig`, and
`DesktopAppDescriptor` to carry the handler layer `E` and `R` parameters through the descriptor.
That made normal Effect composition visible again:

```ts
const NotesRpcsLive = NotesRpcs.toLayer({
  "Notes.List": () => Greeting.pipe(Effect.map((greeting) => [greeting]))
})

const App = Desktop.make({
  id: "notes",
  windows: { main: { title: "Notes", renderer: "/" } },
  rpcs: [Desktop.Rpcs.layer(NotesRpcs, NotesRpcsLive)]
})

const MainLayer = Desktop.layer(App).pipe(Layer.provide(GreetingLive))
```

## Review changes

Review changed the implementation in three places:

- descriptor RPC layers now preserve handler `E` and `R` instead of erasing them behind metadata;
- descriptor fields that `Desktop.make` always materializes are concrete, not optional;
- tests now prove an RPC handler can require an external service supplied around `Desktop.layer(App)`.

## Architecture-debt sweep

Removed here: `DesktopAppDefinition`, custom app `pipe`, `Desktop.provide`, `Desktop.toLayer`,
arbitrary app `layers`, and the `user-layer` runtime graph node. The remaining `Desktop.Rpcs.layer`
helper is a boundary adapter with durable desktop semantics, not a second Effect composition model.

Follow-ups opened and tracked in the roadmap: #1295 for Solid/Vue endpoint support casts and #1296
for core Desktop runtime Layer variance casts. #1294 already tracks the equivalent React endpoint
support cast.

## Rule

When replacing a custom builder DSL with descriptors, type the descriptor from the Effect layers it
contains; otherwise the new API can look Effect-native while still erasing service requirements.
