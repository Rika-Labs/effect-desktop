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
import { Desktop } from "@effect-desktop/core"
import { Clipboard, ClipboardError, ClipboardRpcs, Native } from "@effect-desktop/native"
```

## Status

The TypeScript service, Effect RPC contracts, and Rust host router are wired for text, HTML, image, clear,
and capability checks. The current Rust host adapter returns typed `Unsupported` errors for clipboard
operations on macOS, Windows, and Linux until an OS clipboard backend is added. `isSupported` reports
`false` with reason `host-adapter-unimplemented`; Linux primary-selection behavior is explicitly
unsupported through the `selection` capability.

## Methods

| Method        | Payload                                                                 | Success                                                    |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `readText`    | —                                                                       | `{ text: string }`                                         |
| `writeText`   | `{ text: string }`                                                      | `void`                                                     |
| `readHtml`    | —                                                                       | `{ html: string }`                                         |
| `writeHtml`   | `{ html: string }`                                                      | `void`                                                     |
| `readImage`   | —                                                                       | `{ mime: "image/png" \| "image/jpeg", bytes: Uint8Array }` |
| `writeImage`  | `{ mime: "image/png" \| "image/jpeg", bytes: Uint8Array }`              | `void`                                                     |
| `clear`       | —                                                                       | `void`                                                     |
| `isSupported` | `{ capability: "text" \| "html" \| "image" \| "clear" \| "selection" }` | `{ supported: boolean, reason?: string }`                  |

## Errors

`ClipboardError` is the host protocol error union. Current host operations fail with
`HostProtocolUnsupportedError` rather than silently succeeding or returning fake data.

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

`ClipboardTest()` from `@effect-desktop/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/clipboard.ts`](../../../packages/native/src/clipboard.ts)
