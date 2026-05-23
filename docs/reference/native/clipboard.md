---
title: Clipboard (native)
description: Clipboard host protocol surface.
kind: reference
audience: app-developers
effect_version: 4
---

# `Clipboard`

Clipboard host protocol surface.

## Import

```ts
import { Desktop } from "@orika/core"
import { Clipboard, ClipboardError, ClipboardRpcs, Native } from "@orika/native"
import { ClipboardRpcs as RendererClipboardRpcs } from "@orika/native/renderer"
```

Runtime and service code import from `@orika/native`. Browser renderer
manifests import the renderer-safe RPC group from `@orika/native/renderer`.

## Status

The TypeScript service, Effect RPC contracts, and Rust host router are wired to an OS clipboard backend
for text, HTML, image, clear, and capability checks on macOS, Windows, and Linux. `isSupported` reports
`true` for text, HTML, image, and clear when the host can open the system clipboard, and reports `false`
with reason `host-clipboard-unavailable` or `host-clipboard-busy` when the OS clipboard is unavailable.
Linux primary-selection behavior is explicitly unsupported through the `selection` capability.

`isSupported` results are strict: supported results do not include `reason`, and unsupported results
must include `reason`. The Effect service returns the same `ClipboardSupportedResult` shape as the
RPC/client boundary; branch on `.supported` when a boolean check is enough. Malformed host output at
this boundary is reported as `InvalidOutput`.

## Methods

| Method        | Payload                                                                 | Success                                                         |
| ------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `readText`    | —                                                                       | `{ text: string }`                                              |
| `writeText`   | `{ text: string }`                                                      | `void`                                                          |
| `readHtml`    | —                                                                       | `{ html: string }`                                              |
| `writeHtml`   | `{ html: string }`                                                      | `void`                                                          |
| `readImage`   | —                                                                       | `{ mime: "image/png" \| "image/jpeg", bytes: Uint8Array }`      |
| `writeImage`  | `{ mime: "image/png" \| "image/jpeg", bytes: Uint8Array }`              | `void`                                                          |
| `clear`       | —                                                                       | `void`                                                          |
| `isSupported` | `{ capability: "text" \| "html" \| "image" \| "clear" \| "selection" }` | `{ supported: true }` or `{ supported: false, reason: string }` |

## Errors

`ClipboardError` is the host protocol error union. Host operations return typed errors for unavailable
clipboard content, unsupported OS clipboard access, busy clipboard ownership, and host failures rather
than silently succeeding or returning fake data.

## App composition

```ts
Desktop.make({
  id: "com.acme.clipboard",
  windows: Desktop.window("main", { title: "Clipboard" }),
  native: Desktop.native(Native.Clipboard),
  permissions: Desktop.permissions(Desktop.permission(Native.Permissions.clipboard.readText))
})
```

`Native.Clipboard` registers the clipboard surface. `Native.Permissions.clipboard.readText` grants read-text authority.
`ClipboardLive` and `ClipboardHandlersLive` are runtime layers behind the native surface.

Use `Native.Permissions.clipboard.all` only when the app grants every privileged clipboard method.

## Test layer

`ClipboardTest()` from `@orika/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/clipboard.ts`](../../../packages/native/src/clipboard.ts)
