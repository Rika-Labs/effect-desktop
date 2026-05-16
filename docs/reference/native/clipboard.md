---
title: Clipboard (native)
description: Read and write the system clipboard.
kind: reference
audience: app-developers
effect_version: 4
---

# `Clipboard`

System clipboard read/write.

## Import

```ts
import { Desktop } from "@effect-desktop/core"
import { Clipboard, ClipboardError, ClipboardRpcs, Native } from "@effect-desktop/native"
```

## Methods

| Method      | Payload            | Success            |
| ----------- | ------------------ | ------------------ |
| `readText`  | —                  | `{ text: string }` |
| `writeText` | `{ text: string }` | `void`             |

## Errors

`ClipboardError` — generic platform clipboard failure.

## App composition

```ts
Desktop.make({
  id: "com.acme.clipboard",
  windows: Desktop.window("main", { title: "Clipboard" }),
  native: Native.capabilities(Native.Clipboard.readText)
})
```

`Native.Clipboard.readText` registers the clipboard surface and grants the read-text authority.
`ClipboardLive` and `ClipboardHandlersLive` are runtime layers behind that selection.

Use `Native.Clipboard.all` only when the app grants every privileged clipboard method.

## Test layer

`ClipboardTest()` from `@effect-desktop/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/clipboard.ts`](../../../packages/native/src/clipboard.ts)
