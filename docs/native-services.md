---
title: Native services
description: 20 host-backed native capabilities exposed as Effect RPC groups.
kind: reference
audience: app-developers
effect_version: 4
---

# Native services

> Full references: [`reference/native/`](reference/native/) — one page per service.

Native services expose host-backed desktop capability through Effect services and RPC groups.
Apps select native capabilities by passing generated `Native` selections to `Desktop.native(...)`.

## App composition

Select only the native surfaces the app uses:

```ts
Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Desktop.native(Native.Clipboard.readText)
})
```

`Native.all` registers every built-in native surface and grants every privileged native method:

```ts
Desktop.make({
  id: "com.acme.native",
  windows: Desktop.window("main", { title: "Native" }),
  native: Desktop.native(Native.all)
})
```

Each native surface exposes grouped capability data when an app intentionally grants an entire surface:

```ts
Desktop.make({
  id: "com.acme.windows",
  windows: Desktop.window("main", { title: "Windows" }),
  native: Desktop.native(Native.Window.all)
})
```

Pass `Native.Clipboard` directly to `Desktop.native(...)` only when the app needs support metadata or unprivileged status methods without granting native authority.

## Module shape

Native modules keep one source of truth for service, RPC, client, host, support, and
permission facts:

- `<Name>Rpcs` — canonical RPC group.
- `<Name>Surface` — generated surface metadata.
- `<Name>` — runtime Effect service.
- `<Name>Client` — client service.
- `Native.<Name>.<method>` — app-composition capability selection for one privileged native method.
- `Native.<Name>.all` — app-composition capability selection for one native surface.
- `Desktop.native(Native.<Name>)` — availability-only selection with no authority grant.
- `Native.capabilities(...)`, `Native.available(...)` — lower-level helpers that return native declaration layers.
- `<Name>Live`, `<Name>HandlersLive` — runtime layers behind the native capability selection.
- `make<Name>ClientLayer`, `make<Name>ServiceLayer` — deterministic test seams, not
  app-composition APIs.
- `<Name>MethodNames`, `<Name>RpcEvents`, typed errors, handlers, and API types.

This is the [layer-first contract](explanation/layer-first-design.md) applied uniformly.

Native service authors should use the internal native surface authoring path, not ad hoc RPC construction. Each endpoint must carry schemas, endpoint kind, support metadata, and authority metadata together. `NativeCapabilities` reads the selected native registrations, so the public support manifest uses the same source of truth as handlers, clients, tests, and renderer descriptors.

## Current native modules

| Module             | Purpose                     | Reference                                                         |
| ------------------ | --------------------------- | ----------------------------------------------------------------- |
| `App`              | App lifecycle               | [native/app](reference/native/app.md)                             |
| `Clipboard`        | Read/write clipboard        | [native/clipboard](reference/native/clipboard.md)                 |
| `ContextMenu`      | Context menus               | [native/context-menu](reference/native/context-menu.md)           |
| `CrashReporter`    | Crash reporter              | [native/crash-reporter](reference/native/crash-reporter.md)       |
| `Dialog`           | File, save, message dialogs | [native/dialog](reference/native/dialog.md)                       |
| `Dock`             | macOS dock                  | [native/dock](reference/native/dock.md)                           |
| `GlobalShortcut`   | OS keyboard shortcuts       | [native/global-shortcut](reference/native/global-shortcut.md)     |
| `Menu`             | App and window menus        | [native/menu](reference/native/menu.md)                           |
| `Notification`     | System notifications        | [native/notification](reference/native/notification.md)           |
| `Path`             | Platform path lookup        | [native/path](reference/native/path.md)                           |
| `Protocol`         | App protocol routing        | [native/protocol](reference/native/protocol.md)                   |
| `PowerMonitor`     | Power source events         | [native/power-monitor](reference/native/power-monitor.md)         |
| `SafeStorage`      | Encrypted storage primitive | [native/safe-storage](reference/native/safe-storage.md)           |
| `Screen`           | Displays, pointer           | [native/screen](reference/native/screen.md)                       |
| `Shell`            | Open path, external URL     | [native/shell](reference/native/shell.md)                         |
| `SystemAppearance` | Theme, accent               | [native/system-appearance](reference/native/system-appearance.md) |
| `Tray`             | Tray icon and menu          | [native/tray](reference/native/tray.md)                           |
| `Updater`          | Check, download, install    | [native/updater](reference/native/updater.md)                     |
| `WebView`          | Embedded WebView            | [native/webview](reference/native/webview.md)                     |
| `Window`           | Window lifecycle            | [native/window](reference/native/window.md)                       |

## Verify Native Exports

```ts run
import { ClipboardRpcs, DialogRpcs, WindowRpcs } from "../packages/native/src/index.js"

if (ClipboardRpcs === undefined || DialogRpcs === undefined || WindowRpcs === undefined) {
  throw new Error("native RPC groups are unavailable")
}
```

## Support checks

Platform-limited operations must be guarded through support metadata or `isSupported` methods. Unsupported capability is a **typed result**, not an implicit no-op.

`NativeCapabilities` exposes a manifest of native method facts. Each fact includes the method tag, its capability metadata, and its support metadata. Unknown tags fail with `NativeCapabilityLookupError`; unsupported methods fail `require(tag)` with `UnsupportedCapability`.

## Where to go next

- [How-to: integrate native services](how-to/integrate-native-services.md)
- [`reference/native/`](reference/native/) — per-module
