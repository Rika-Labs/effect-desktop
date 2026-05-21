# Require Live Test and Client Layers

Issue: #1230

## What changed

Clipboard and Dialog now follow the same Layer-first shape as Screen. Their handlers are exposed as
`ClipboardHandlersLive` and `DialogHandlersLive`, their generated surfaces are exposed as
`ClipboardSurface` and `DialogSurface`, and their bridge client layers route through the generated
`DesktopRpc.surface(...)` client path instead of local `RpcClient.make(...)` loops.

The shared capability test in `@orika/test` now runs the same user-level Screen,
Clipboard, and Dialog programs through direct Live layers, bridge Client layers, and deterministic
Test layers. The test package also dropped the old `Test*.layer` wrapper objects in favor of
top-level `ScreenTest(...)`, `ClipboardTest()`, and `DialogTest(...)` layer constructors.

## What mattered

The important boundary was scope. A generated Effect RPC client is a scoped resource, but the public
capability service can be acquired from a layer and then used later. Returning the generated client
directly from `makeClipboardBridgeClientLayer(...)` or `makeDialogBridgeClientLayer(...)` would close
the protocol scope before an extracted method call used it.

The final bridge service keeps the generated surface as the canonical client path, but each public
method acquires the generated client inside that method's scoped Effect. That preserves durable
desktop boundary behavior without reintroducing the old hand-rolled RPC construction loop.

```ts
const useClient = <A>(
  use: (client: ClipboardClientApi) => Effect.Effect<A, ClipboardError, never>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* ClipboardClient
      return yield* use(client)
    }).pipe(
      Effect.provide(ClipboardSurface.clientLayer),
      Effect.provide(makeClipboardBridgeProtocolLayer(exchange, options))
    )
  )
```

## Review changes

Review caught two issues that changed the final design. First, extracted Clipboard/Dialog services
could lose their bridge protocol scope when methods were called after layer acquisition. Second,
surface coverage was metadata-heavy and did not run Clipboard/Dialog RPCs through
`surface.testClientLayer`.

Both became tests: valid extracted bridge methods now prove the method-scoped acquisition path, and
Clipboard/Dialog surface test-client layers now execute real RPC calls.

## Architecture-debt sweep

The scoped debt removed here was the local Clipboard/Dialog `RpcClient.make(...)` client loops. A
new capability-contract DSL was deliberately not added because it would only group existing Effect
`Layer` values without owning durable desktop semantics.

The remaining bridge cleanup was intentionally separate. #1271 tracks generated test native clients
from `DesktopRpc` surfaces, and #1292 later removed the public `BridgeRpc` DSL once canonical Effect
RPC owned renderer contracts directly.

## Rule

When replacing hand-rolled bridge clients with generated Effect RPC client layers, test both
in-scope use and extracted-service use if the public service can escape the acquisition scope.
