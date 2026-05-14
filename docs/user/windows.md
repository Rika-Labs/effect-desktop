# Windows

Window operations are typed native-service calls that return Effect values rather than throwing platform errors.

## Runnable Example

```ts run
import { WindowRpcs, WindowMethodNames } from "../packages/native/src/index.js"

if (WindowRpcs === undefined || !WindowMethodNames.includes("create")) {
  throw new Error("window RPC group is unavailable")
}
```

## Runtime usage

Use the `Window` service from runtime code. The service returns Effects, so invalid input, missing host support, stale handles, and host protocol failures stay in the typed error channel.

```ts
import { Effect } from "effect"
import { Window } from "@effect-desktop/native"

export const openAndClose = Effect.gen(function* () {
  const windows = yield* Window
  const window = yield* windows.create({ title: "Notes" })

  yield* windows.close(window)
})
```

## Renderer usage

Renderer code should consume the imported RPC group through the framework adapter. The adapter exposes endpoint support metadata next to the hook state.

```tsx
const window = DesktopApp.useDesktop(WindowRpcs)
const createWindow = window.create.useMutation()

return (
  <button
    disabled={!createWindow.isSupported || createWindow.status === "running"}
    onClick={() => createWindow.run({ title: "Notes" })}
  >
    Open
  </button>
)
```

The React built-in Window helpers follow the same supported surface: `windows.create.useMutation()`, `windows.close.useMutation()`, and `currentWindow.close.useMutation()`. Title mutation helpers are not exported because `Window.setTitle` is not part of the callable Window contract yet.

## Support model

`WindowMethodNames` lists the callable Window contract implemented by the host path. Planned methods are not listed until the implementation exists.

`WindowRpcs` and `WindowSupportedRpcs` currently contain `Window.create` and `Window.close`.

`makeWindowBridgeClientLayer(exchange, options)` accepts `WindowBridgeClientOptions`, which intentionally omits `nextRequestId`. The generated Effect RPC protocol owns request identifiers for this path.

The generated Window client validates outbound input before it crosses the host boundary and validates host success payloads before returning app values. Malformed create or close results fail as `HostProtocolInvalidOutputError`; malformed caller input fails as `HostProtocolInvalidArgumentError`.

Before presenting a renderer action, check endpoint support metadata. In runtime programs, depend on the `Window` service for supported operations and handle `WindowError` values from the effect channel.
