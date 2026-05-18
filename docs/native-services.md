---
title: Native services
description: Native capability surfaces exposed as Effect services and RPC groups.
kind: reference
audience: app-developers
effect_version: 4
---

# Native services

> Full references: [`reference/native/`](reference/native/) — one page per service.

Native services expose desktop capability through Effect services and RPC groups. The Rust host backs the implemented subset; prerelease surfaces and methods report support metadata and fail through typed host errors until their platform adapters exist.
Apps select native capabilities by passing generated `Native` selections to `Desktop.native(...)`.

## App composition

Select only the native surfaces the app uses:

```ts
Desktop.make({
  id: "com.acme.app",
  windows: Desktop.window("main", { title: "Acme" }),
  native: Desktop.native(Native.Clipboard),
  permissions: Desktop.permissions(Desktop.permission(Native.Permissions.clipboard.readText))
})
```

`Native.all` registers every built-in native surface. Grant every native authority explicitly with `Native.Permissions.all`:

```ts
Desktop.make({
  id: "com.acme.native",
  windows: Desktop.window("main", { title: "Native" }),
  native: Desktop.native(Native.all),
  permissions: Desktop.permissions(...Native.Permissions.all.map(Desktop.permission))
})
```

Each native surface exposes grouped permission data when an app intentionally grants an entire surface:

```ts
Desktop.make({
  id: "com.acme.windows",
  windows: Desktop.window("main", { title: "Windows" }),
  native: Desktop.native(Native.Window),
  permissions: Desktop.permissions(...Native.Permissions.window.all.map(Desktop.permission))
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
- `Native.Permissions.<name>.<method>` — permission declaration for one privileged native method.
- `Native.Permissions.<name>.all` — permission declarations for one native surface.
- `Desktop.native(Native.<Name>)` — availability-only selection with no authority grant.
- `Native.available(...)` — lower-level helper that returns native availability declarations.
- `<Name>Live`, `<Name>HandlersLive` — runtime layers behind the native capability selection.
- `make<Name>ClientLayer`, `make<Name>ServiceLayer` — deterministic test seams, not
  app-composition APIs.
- `<Name>MethodNames`, `<Name>RpcEvents`, typed errors, handlers, and API types.

This is the [layer-first contract](explanation/layer-first-design.md) applied uniformly.

Native service authors should use the internal native surface authoring path, not ad hoc RPC construction. Each endpoint must carry schemas, endpoint kind, support metadata, and authority metadata together. `NativeCapabilities` reads the selected native registrations, so the public support manifest uses the same source of truth as handlers, clients, tests, and renderer descriptors.

## Current native modules

| Module                      | Purpose                                 | Reference                                                                             |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `App`                       | App lifecycle                           | [native/app](reference/native/app.md)                                                 |
| `Clipboard`                 | Read/write clipboard                    | [native/clipboard](reference/native/clipboard.md)                                     |
| `ContextMenu`               | Context menu contracts                  | [native/context-menu](reference/native/context-menu.md)                               |
| `CrashReporter`             | Crash reporter                          | [native/crash-reporter](reference/native/crash-reporter.md)                           |
| `DiagnosticsBundle`         | Diagnostics export                      | [native/diagnostics-bundle](reference/native/diagnostics-bundle.md)                   |
| `Dialog`                    | File, save, message dialogs             | [native/dialog](reference/native/dialog.md)                                           |
| `Dock`                      | Dock/taskbar state                      | [native/dock](reference/native/dock.md)                                               |
| `EgressPolicy`              | Network egress decisions, not transport | [native/egress-policy](reference/native/egress-policy.md)                             |
| `ExecutionSandbox`          | Isolated execution policy               | [native/execution-sandbox](reference/native/execution-sandbox.md)                     |
| `ExtensionConfig`           | Extension settings                      | [native/extension-config](reference/native/extension-config.md)                       |
| `ExtensionPackage`          | Extension package lifecycle             | [native/extension-package](reference/native/extension-package.md)                     |
| `LocalToolRuntime`          | Local tool runtime                      | [native/local-tool-runtime](reference/native/local-tool-runtime.md)                   |
| `TransactionalFileMutation` | Safe file mutation prepare/commit       | [native/transactional-file-mutation](reference/native/transactional-file-mutation.md) |
| `WorkspaceIndex`            | Workspace index sessions                | [native/workspace-index](reference/native/workspace-index.md)                         |
| `GlobalShortcut`            | Shortcut command contracts              | [native/global-shortcut](reference/native/global-shortcut.md)                         |
| `Menu`                      | App/window menu install and contracts   | [native/menu](reference/native/menu.md)                                               |
| `NativeFileSystem`          | Filesystem handles and watches          | [native/native-file-system](reference/native/native-file-system.md)                   |
| `Notification`              | System notifications                    | [native/notification](reference/native/notification.md)                               |
| `Path`                      | Platform path lookup                    | [native/path](reference/native/path.md)                                               |
| `Protocol`                  | App protocol routing                    | [native/protocol](reference/native/protocol.md)                                       |
| `PowerMonitor`              | Power source events                     | [native/power-monitor](reference/native/power-monitor.md)                             |
| `RealtimeMediaSession`      | Realtime media sessions                 | [native/realtime-media-session](reference/native/realtime-media-session.md)           |
| `SafeStorage`               | Credential-store boundary               | [native/safe-storage](reference/native/safe-storage.md)                               |
| `Screen`                    | Displays, pointer                       | [native/screen](reference/native/screen.md)                                           |
| `Shell`                     | Open path, external URL                 | [native/shell](reference/native/shell.md)                                             |
| `SystemAppearance`          | Theme, accent                           | [native/system-appearance](reference/native/system-appearance.md)                     |
| `Tray`                      | Tray icon and menu                      | [native/tray](reference/native/tray.md)                                               |
| `Updater`                   | Check, download, install                | [native/updater](reference/native/updater.md)                                         |
| `WebView`                   | Embedded WebView                        | [native/webview](reference/native/webview.md)                                         |
| `Window`                    | Window lifecycle                        | [native/window](reference/native/window.md)                                           |

## Verify Native Exports

```ts run
import { ClipboardRpcs, DialogRpcs, WindowRpcs } from "../packages/native/src/index.js"

if (ClipboardRpcs === undefined || DialogRpcs === undefined || WindowRpcs === undefined) {
  throw new Error("native RPC groups are unavailable")
}
```

## Support checks

Platform-limited operations must be guarded through support metadata or `isSupported` methods. Unsupported capability is a **typed result**, not an implicit no-op.

`NativeCapabilities` exposes a manifest of native method facts. Each fact includes the method tag, its capability metadata, and Schema-typed maturity metadata. Status is `supported`, `partial`, or `unsupported`; `partial` and `unsupported` include a reason, and platform-specific entries record macOS, Windows, and Linux differences. Unknown tags fail with `NativeCapabilityLookupError`; unsupported methods fail `require(tag)` with `UnsupportedCapability`; platform-specific unsupported entries fail `requirePlatform(tag, platform)` with the same typed error and platform detail.

The generated [native parity matrix](reference/native/parity-matrix.md) is the docs/doctor reporting artifact. It is generated from `Native.all` schema docs and the Rust host dispatch registry, and the generator writes the same JSON snapshot to the docs tree and the CLI package. `desktop doctor` decodes the bundled CLI snapshot for its `native-capabilities` probe, so installed CLIs do not depend on a repository-local docs path.

Native boundary failures use the closed `HostProtocolError` Schema vocabulary on every native RPC surface. Application code that needs a smaller decision surface can use `NativeBoundaryErrors` or `normalizeNativeBoundaryEffect` to classify host-protocol failures into `denied`, `unsupported`, `missing-host-method`, `invalid-input`, `invalid-output`, or `host-failed` without string parsing.

## Where to go next

- [How-to: integrate native services](how-to/integrate-native-services.md)
- [`reference/native/`](reference/native/) — per-module
