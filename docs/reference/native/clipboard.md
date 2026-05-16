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
import { Clipboard, ClipboardClient, ClipboardRpcs, ClipboardError } from "@effect-desktop/native"
```

## Methods

| Method      | Payload            | Success            |
| ----------- | ------------------ | ------------------ |
| `readText`  | —                  | `{ text: string }` |
| `writeText` | `{ text: string }` | `void`             |

## Errors

`ClipboardError` — generic platform clipboard failure.

## Layer

`ClipboardLive`, `ClipboardHandlersLive`, `Native.clipboard`.

Use `Native.Permissions.clipboard.readText` with `Desktop.permission(...)` when the app allows reading clipboard text.

## Test layer

`ClipboardTest()` from `@effect-desktop/test`.

## Related

- How-to: [Integrate native services](../../how-to/integrate-native-services.md)
- Source: [`packages/native/src/clipboard.ts`](../../../packages/native/src/clipboard.ts)
