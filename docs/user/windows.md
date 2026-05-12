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

The React built-in Window helpers follow the same supported surface: `windows.create.useMutation()`, `windows.close.useMutation()`, and `currentWindow.close.useMutation()`. Title mutation helpers are not exported while `Window.setTitle` remains unsupported descriptor metadata.

## Support model

`WindowMethodNames` lists the Phase 5 Window contract. The host implementation can lag that contract. Unsupported methods remain in `WindowRpcs` so descriptors, docs, tests, and compatibility handlers can describe the full surface.

`WindowSupportedRpcs` is the callable generated group. It currently contains `Window.create` and `Window.close`; unsupported descriptor methods such as `Window.show`, `Window.setTitle`, and `Window.setVibrancy` are intentionally absent from the generated client service.

`makeWindowBridgeClientLayer(exchange, options)` accepts `WindowBridgeClientOptions`, which intentionally omits `nextRequestId`. The generated Effect RPC protocol owns request identifiers for this path.

The generated Window client validates outbound input before it crosses the host boundary and validates host success payloads before returning app values. Malformed create or close results fail as `HostProtocolInvalidOutputError`; malformed caller input fails as `HostProtocolInvalidArgumentError`.

Before presenting a renderer action, check endpoint support metadata. In runtime programs, depend on the `Window` service for supported operations and handle `WindowError` values from the effect channel.
