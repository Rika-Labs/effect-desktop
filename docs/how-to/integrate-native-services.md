---
title: How to integrate native services
description: Call clipboard, dialog, screen, notification, and other native services from a renderer.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to integrate native services

Native services live under `@orika/native`. Runtime code imports native layers from the package root; renderer code imports browser-safe `RpcGroup` descriptors from `@orika/native/renderer` and calls them through `useDesktop(...)`.

## Runtime setup

Select native capabilities in `Desktop.make`. Use `Native.all` for the broad built-in set or list only the methods the app uses.

```ts
import { Desktop } from "@orika/core"
import { Native } from "@orika/native"

export const App = Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Desktop.native(Native.Clipboard, Native.Dialog),
  permissions: Desktop.permissions(
    Desktop.permission(Native.Permissions.clipboard.readText),
    Desktop.permission(Native.Permissions.dialog.openFile)
  )
})
```

`Desktop.native(...)` registers the required native surfaces. `Desktop.permissions(...)` grants only the selected privileged calls.

## The pattern

For any native module `<Name>` (Window, Clipboard, Dialog, Screen, …):

1. The renderer imports `<Name>Rpcs` from `@orika/native/renderer` and calls `useDesktop(<Name>Rpcs)` to get a typed client.
2. The framework dispatches to a runtime handler.
3. The handler talks to the Rust host through the bridge.
4. A typed result or `<Name>Error` returns.

You never construct the host call directly. (See [boundary rule](../explanation/boundary-rule.md).)

## Example: clipboard

```tsx
import { ReactDesktop } from "@orika/react"
import { ClipboardRpcs } from "@orika/native/renderer"
import { Manifest } from "./manifest.js"

const DesktopApp = ReactDesktop.from(Manifest)

function CopyButton({ text }: { text: string }) {
  const clipboard = DesktopApp.useDesktop(ClipboardRpcs)
  const writeText = clipboard.writeText.useMutation()

  return (
    <button onClick={() => writeText.run({ text })} disabled={writeText.status === "running"}>
      Copy
    </button>
  )
}
```

`ClipboardRpcs.writeText` accepts `{ text }` and returns `void`. `ClipboardRpcs.readText` returns `{ text }`.

## Example: dialog

```tsx
import { Exit } from "effect"
import { DialogRpcs } from "@orika/native/renderer"

function OpenButton() {
  const dialog = DesktopApp.useDesktop(DialogRpcs)
  const openFile = dialog.openFile.useMutation()

  const onClick = async () => {
    const exit = await openFile.runPromise({
      filters: [{ name: "Markdown", extensions: ["md"] }]
    })
    if (Exit.isSuccess(exit) && exit.value.paths.length > 0) {
      // exit.value.paths is string[]
    }
  }

  return <button onClick={onClick}>Open file…</button>
}
```

## Example: notification

```tsx
import { NotificationRpcs } from "@orika/native/renderer"

const notification = DesktopApp.useDesktop(NotificationRpcs)
const show = notification.show.useMutation()

show.run({ title: "Done", body: "Indexing complete." })
```

## Example: native hooks

The React adapter wraps a few high-frequency reads as hooks:

```tsx
import type { PowerMonitor, Screen, SystemAppearance } from "@orika/native"
import { useDisplays, usePower, useTheme } from "@orika/react"

function StatusBar(props: {
  readonly appearance: SystemAppearance["Service"]
  readonly screen: Screen["Service"]
  readonly powerMonitor: PowerMonitor["Service"]
}) {
  const theme = useTheme(props.appearance.onAppearanceChanged)
  const displays = useDisplays(props.screen.getDisplays)
  const power = usePower({
    onSuspend: props.powerMonitor.onSuspend,
    onResume: props.powerMonitor.onResume,
    onShutdown: props.powerMonitor.onShutdown,
    onLockScreen: props.powerMonitor.onLockScreen,
    onUnlockScreen: props.powerMonitor.onUnlockScreen,
    onPowerSourceChanged: props.powerMonitor.onPowerSourceChanged
  })
  return (
    <span>
      {theme.data?.appearance ?? "unknown"} · {displays.data?.length ?? 0} displays
    </span>
  )
}
```

These are convenience hooks over the matching RPC clients; under the hood they
call `Screen.getDisplays`, the TypeScript `SystemAppearance` stream, and the
TypeScript `PowerMonitor` event streams. Native appearance delivery is
host-backed on macOS and Windows and reports typed unsupported failures on
Linux. Native OS power-event delivery is available on macOS and reports typed
unsupported failures on Windows and Linux.

## Support checks

Some native operations are platform-limited (`Dock` on macOS, certain `Tray` features on Linux). Each module exposes either:

- An `isSupported(method)` RPC that returns `{ supported: boolean }`.
- Support metadata on the RPC descriptor (queryable via `Desktop.Rpc.surface(...)`).

Don't assume support — check it and degrade gracefully.

## Permissions

`native.invoke` capabilities cover native services. Declare allowed native calls with permission constants such as `Native.Permissions.clipboard.readText`. Pass `Native.Clipboard` directly to `Desktop.native(...)` for availability. Privileged calls such as `SafeStorage`, `Updater.install`, and `Protocol.register` should stay explicit and reviewable.

## Related

- Reference: [Native RPC groups](../reference/native/) — every method, payload, and error
- Explanation: [Boundary rule](../explanation/boundary-rule.md), [RPC surface vs. mapped](../explanation/rpc-surface-vs-mapped.md)
