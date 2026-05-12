# Native Services

Native services expose platform capabilities as typed Effect services and preserve unsupported behavior as values.

## Runnable Example

```ts run
import { ClipboardRpcs, DialogRpcs, WindowRpcs } from "../packages/native/src/index.js"

if (ClipboardRpcs === undefined || DialogRpcs === undefined || WindowRpcs === undefined) {
  throw new Error("native service RPC groups are unavailable")
}
```

## Current shape

Native services have two public layers:

- Effect services such as `Screen`, `Window`, and `Dialog` for runtime programs.
- `*Rpcs` groups for renderer-callable contracts and framework descriptors.

`Screen` is the first generated Layer-first native surface. `ScreenRpcs` is a pure Effect `RpcGroup`; `ScreenSurface` derives server, client, test-client, schema-doc, and law artifacts from that group. The bridge exchange remains only at the adapter boundary through `makeScreenBridgeClientLayer(...)`.

`Window` exposes the full Phase 5 method contract as `WindowRpcs`, then derives `WindowSupportedRpcs` for the generated callable client. Today that supported client contains `Window.create` and `Window.close`. Planned chrome mutation, focus, fullscreen, scale, and persistence methods remain visible as unsupported descriptor metadata.

## Screen

```ts
import { Effect } from "effect"
import { Screen } from "@effect-desktop/native"

const readPointer = Effect.gen(function* () {
  const screen = yield* Screen
  return yield* screen.getPointerPoint()
})
```

For renderer code, derive hooks from the imported group:

```tsx
const screen = DesktopApp.useDesktop(ScreenRpcs)
const pointer = screen.getPointerPoint.useMutation()
```

## Window

Use `Window` for runtime code that needs to create or close host windows:

```ts
import { Effect } from "effect"
import { Window } from "@effect-desktop/native"

const openNotes = Effect.gen(function* () {
  const windows = yield* Window
  const window = yield* windows.create({ title: "Notes" })
  return window
})
```

Unsupported descriptor-only Window methods are not callable through `WindowClientApi`. Do not probe by catching thrown exceptions; inspect descriptor support metadata before presenting those actions. Supported callable methods still return typed `WindowError` values in the Effect error channel.

The generated Window client validates both sides of the bridge boundary: invalid caller input fails as `HostProtocolInvalidArgumentError`, and malformed host success payloads fail as `HostProtocolInvalidOutputError`.

Test clients follow the same callable surface. A test `WindowClientApi` should implement `create` and `close`; it should not add methods that the supported generated client cannot call.
