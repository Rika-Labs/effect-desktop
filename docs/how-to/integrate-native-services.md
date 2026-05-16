---
title: How to integrate native services
description: Call clipboard, dialog, screen, notification, and other native services from a renderer.
kind: how-to
audience: app-developers
effect_version: 4
---

# How to integrate native services

Native services live under `@effect-desktop/native`. Each one ships with an `RpcGroup` you call through `useDesktop(...)` after the runtime entry selects the matching native layer.

## Runtime setup

Select native capabilities in `Desktop.make`. Use `Native.all` for the broad built-in set or list only the methods the app uses.

```ts
import { Desktop } from "@effect-desktop/core"
import { Native } from "@effect-desktop/native"

export const App = Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Native.capabilities(Native.Clipboard.readText, Native.Dialog.openFile)
})
```

`Native.capabilities(...)` registers the required native surfaces and grants only the selected privileged calls.

## The pattern

For any native module `<Name>` (Window, Clipboard, Dialog, Screen, …):

1. The renderer calls `useDesktop(<Name>Rpcs)` to get a typed client.
2. The framework dispatches to a runtime handler.
3. The handler talks to the Rust host through the bridge.
4. A typed result or `<Name>Error` returns.

You never construct the host call directly. (See [boundary rule](../explanation/boundary-rule.md).)

## Example: clipboard

```tsx
import { ReactDesktop } from "@effect-desktop/react"
import { ClipboardRpcs } from "@effect-desktop/native"
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
import { DialogRpcs } from "@effect-desktop/native"

function OpenButton() {
  const dialog = DesktopApp.useDesktop(DialogRpcs)
  const open = dialog.open.useMutation()

  const onClick = async () => {
    const result = await open.run({
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md"] }]
    })
    if (!result.canceled) {
      // result.filePaths is string[]
    }
  }

  return <button onClick={onClick}>Open file…</button>
}
```

## Example: notification

```tsx
import { NotificationRpcs } from "@effect-desktop/native"

const notification = DesktopApp.useDesktop(NotificationRpcs)
const show = notification.show.useMutation()

await show.run({ title: "Done", body: "Indexing complete." })
```

## Example: native hooks

The React adapter wraps a few high-frequency reads as hooks:

```tsx
import { useTheme, useDisplays, usePower } from "@effect-desktop/react"

function StatusBar() {
  const theme = useTheme() // { isDark: boolean }
  const displays = useDisplays() // { displays: Display[] }
  const power = usePower() // { event?: PowerEvent }
  return (
    <span>
      {theme.isDark ? "🌙" : "☀️"} · {displays.displays.length} displays
    </span>
  )
}
```

These are convenience hooks over the matching RPC clients; under the hood they call `Screen.getDisplays`, `SystemAppearance.theme`, and `PowerMonitor` events.

## Support checks

Some native operations are platform-limited (`Dock` on macOS, certain `Tray` features on Linux). Each module exposes either:

- An `isSupported(method)` RPC that returns `{ supported: boolean }`.
- Support metadata on the RPC descriptor (queryable via `Desktop.Rpc.surface(...)`).

Don't assume support — check it and degrade gracefully.

## Permissions

`native.invoke` capabilities cover native services. Declare allowed native calls with method selections such as `Native.Clipboard.readText`. Use `Native.available(Native.Clipboard)` only for support checks that need the surface without granting authority. Privileged calls such as `SafeStorage`, `Updater.install`, and `Protocol.register` should stay explicit and reviewable.

## Related

- Reference: [Native RPC groups](../reference/native/) — every method, payload, and error
- Explanation: [Boundary rule](../explanation/boundary-rule.md), [RPC surface vs. mapped](../explanation/rpc-surface-vs-mapped.md)
